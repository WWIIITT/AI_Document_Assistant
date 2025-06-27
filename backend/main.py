from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
import os
import shutil
from pathlib import Path
import asyncio
import json
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Document processing
from langchain.document_loaders import PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.embeddings import OpenAIEmbeddings
from langchain.vectorstores import Chroma
from langchain.chat_models import ChatOpenAI
from langchain.chains import ConversationalRetrievalChain
from langchain.memory import ConversationBufferMemory
from langchain.prompts import PromptTemplate
from langchain.chains.summarize import load_summarize_chain

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
CHROMA_DIR = Path("chroma_db")
CHROMA_DIR.mkdir(exist_ok=True)

# Initialize DeepSeek
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
if not DEEPSEEK_API_KEY:
    raise ValueError("DEEPSEEK_API_KEY not found in environment variables")

# Use DeepSeek API with OpenAI-compatible interface
embeddings = OpenAIEmbeddings(
    openai_api_key=DEEPSEEK_API_KEY,
    openai_api_base="https://api.deepseek.com/v1",
    model="deepseek-chat"
)

llm = ChatOpenAI(
    temperature=0.7,
    model_name="deepseek-chat",
    openai_api_key=DEEPSEEK_API_KEY,
    openai_api_base="https://api.deepseek.com/v1",
    streaming=True
)

# Store for document collections and chains
document_stores = {}
conversation_chains = {}

class ChatMessage(BaseModel):
    message: str
    collection_id: str

class DocumentInfo(BaseModel):
    id: str
    filename: str
    page_count: int
    upload_date: str

class SummarizeRequest(BaseModel):
    collection_id: str
    doc_id: Optional[str] = None

@app.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    """Upload and process a PDF document"""
    try:
        # Save uploaded file
        file_path = UPLOAD_DIR / file.filename
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Load and split document
        loader = PyPDFLoader(str(file_path))
        pages = loader.load()
        
        # Split text into chunks
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            length_function=len
        )
        chunks = text_splitter.split_documents(pages)
        
        # Create unique collection ID
        collection_id = f"collection_{file.filename.replace('.pdf', '')}_{len(document_stores)}"
        
        # Create vector store
        vectorstore = Chroma.from_documents(
            documents=chunks,
            embedding=embeddings,
            collection_name=collection_id,
            persist_directory=str(CHROMA_DIR)
        )
        
        # Store vectorstore reference
        document_stores[collection_id] = {
            "vectorstore": vectorstore,
            "filename": file.filename,
            "chunks": chunks,
            "page_count": len(pages)
        }
        
        # Create conversation chain
        memory = ConversationBufferMemory(
            memory_key="chat_history",
            return_messages=True,
            output_key="answer"
        )
        
        qa_prompt = PromptTemplate(
            template="""Use the following context to answer the question. 
            If you don't know the answer based on the context, say so.
            
            Context: {context}
            
            Question: {question}
            
            Answer:""",
            input_variables=["context", "question"]
        )
        
        conversation_chains[collection_id] = ConversationalRetrievalChain.from_llm(
            llm=llm,
            retriever=vectorstore.as_retriever(search_kwargs={"k": 4}),
            memory=memory,
            return_source_documents=True,
            combine_docs_chain_kwargs={"prompt": qa_prompt}
        )
        
        return {
            "collection_id": collection_id,
            "filename": file.filename,
            "chunks": len(chunks),
            "pages": len(pages),
            "status": "success"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat")
async def chat_with_document(chat_message: ChatMessage):
    """Chat with uploaded documents using RAG"""
    try:
        if chat_message.collection_id not in conversation_chains:
            raise HTTPException(status_code=404, detail="Document collection not found")
        
        chain = conversation_chains[chat_message.collection_id]
        
        async def generate_response():
            # Get response from chain
            response = chain({"question": chat_message.message})
            
            # Stream the answer
            for char in response["answer"]:
                yield f"data: {json.dumps({'content': char, 'type': 'content'})}\n\n"
                await asyncio.sleep(0.01)
            
            # Send source documents
            sources = []
            for doc in response.get("source_documents", []):
                sources.append({
                    "page": doc.metadata.get("page", "Unknown"),
                    "content": doc.page_content[:200] + "..."
                })
            
            yield f"data: {json.dumps({'sources': sources, 'type': 'sources'})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        
        return StreamingResponse(
            generate_response(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            }
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/summarize")
async def summarize_document(request: SummarizeRequest):
    """Summarize entire document or specific sections"""
    try:
        if request.collection_id not in document_stores:
            raise HTTPException(status_code=404, detail="Document collection not found")
        
        doc_info = document_stores[request.collection_id]
        chunks = doc_info["chunks"]
        
        # Create summarization chain
        summarize_chain = load_summarize_chain(
            llm=llm,
            chain_type="map_reduce",
            verbose=False
        )
        
        # Summarize
        summary = summarize_chain.run(chunks[:10])  # Limit chunks for demo
        
        # Extract key points
        key_points_prompt = PromptTemplate(
            template="""Extract 5 key points from this document summary:
            
            {summary}
            
            Format as a numbered list.""",
            input_variables=["summary"]
        )
        
        key_points_chain = key_points_prompt | llm
        key_points = key_points_chain.invoke({"summary": summary}).content
        
        return {
            "summary": summary,
            "key_points": key_points,
            "document": doc_info["filename"]
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/documents")
async def list_documents():
    """List all uploaded documents"""
    documents = []
    for collection_id, info in document_stores.items():
        documents.append({
            "id": collection_id,
            "filename": info["filename"],
            "page_count": info["page_count"],
            "chunk_count": len(info["chunks"])
        })
    return documents

@app.post("/analyze")
async def analyze_document(request: SummarizeRequest):
    """Perform detailed analysis on document"""
    try:
        if request.collection_id not in document_stores:
            raise HTTPException(status_code=404, detail="Document collection not found")
        
        doc_info = document_stores[request.collection_id]
        vectorstore = doc_info["vectorstore"]
        
        # Analysis prompts
        analysis_queries = [
            "What is the main topic or theme of this document?",
            "Who is the target audience for this document?",
            "What are the main arguments or conclusions presented?",
            "Are there any important statistics or data points mentioned?",
            "What recommendations or action items are suggested?"
        ]
        
        analysis_results = {}
        
        for query in analysis_queries:
            # Use similarity search for each query
            relevant_docs = vectorstore.similarity_search(query, k=3)
            
            # Create a focused prompt
            context = "\n".join([doc.page_content for doc in relevant_docs])
            prompt = f"Based on the following context, {query}\n\nContext: {context}\n\nAnswer:"
            
            response = llm.predict(prompt)
            analysis_results[query] = response
        
        return {
            "document": doc_info["filename"],
            "analysis": analysis_results
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/")
async def root():
    return {"message": "Document Assistant API is running with DeepSeek"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)