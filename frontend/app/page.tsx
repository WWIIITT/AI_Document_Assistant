'use client';

import { useState, useEffect } from 'react';
import { Upload, FileText, MessageSquare, BarChart, Loader2, Send } from 'lucide-react';

interface Document {
  id: string;
  filename: string;
  page_count: number;
  chunk_count: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{page: string; content: string}>;
}

export default function DocumentAssistant() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'summary' | 'analysis'>('chat');
  const [summary, setSummary] = useState<any>(null);
  const [analysis, setAnalysis] = useState<any>(null);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const response = await fetch('http://localhost:8000/documents');
      const data = await response.json();
      setDocuments(data);
    } catch (error) {
      console.error('Error fetching documents:', error);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setIsLoading(true);
    try {
      const response = await fetch('http://localhost:8000/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (data.status === 'success') {
        await fetchDocuments();
        setSelectedDoc(data.collection_id);
        setMessages([]);
        setSummary(null);
        setAnalysis(null);
      }
    } catch (error) {
      console.error('Error uploading file:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || !selectedDoc) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: inputMessage
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: inputMessage,
          collection_id: selectedDoc
        }),
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      let assistantMessage: ChatMessage = {
        role: 'assistant',
        content: ''
      };

      setMessages(prev => [...prev, assistantMessage]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'content') {
                assistantMessage.content += data.content;
                setMessages(prev => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1] = {...assistantMessage};
                  return newMessages;
                });
              } else if (data.type === 'sources') {
                assistantMessage.sources = data.sources;
                setMessages(prev => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1] = {...assistantMessage};
                  return newMessages;
                });
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const generateSummary = async () => {
    if (!selectedDoc) return;

    setIsLoading(true);
    try {
      const response = await fetch('http://localhost:8000/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          collection_id: selectedDoc
        }),
      });

      const data = await response.json();
      setSummary(data);
    } catch (error) {
      console.error('Error generating summary:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const analyzeDocument = async () => {
    if (!selectedDoc) return;

    setIsLoading(true);
    try {
      const response = await fetch('http://localhost:8000/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          collection_id: selectedDoc
        }),
      });

      const data = await response.json();
      setAnalysis(data);
    } catch (error) {
      console.error('Error analyzing document:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedDoc && activeTab === 'summary' && !summary) {
      generateSummary();
    } else if (selectedDoc && activeTab === 'analysis' && !analysis) {
      analyzeDocument();
    }
  }, [activeTab, selectedDoc]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">AI Document Assistant</h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Document List */}
          <div className="lg:col-span-1 bg-white rounded-lg shadow p-4">
            <div className="mb-4">
              <label className="flex items-center justify-center w-full px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-gray-400 transition-colors">
                <Upload className="w-5 h-5 mr-2" />
                <span>Upload PDF</span>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf"
                  onChange={handleFileUpload}
                  disabled={isLoading}
                />
              </label>
            </div>

            <div className="space-y-2">
              <h3 className="font-semibold text-gray-700 mb-2">Documents</h3>
              {documents.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => {
                    setSelectedDoc(doc.id);
                    setMessages([]);
                    setSummary(null);
                    setAnalysis(null);
                  }}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    selectedDoc === doc.id
                      ? 'bg-blue-50 border-blue-500 border'
                      : 'bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <div className="flex items-center">
                    <FileText className="w-4 h-4 mr-2 text-gray-600" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {doc.filename}
                      </p>
                      <p className="text-xs text-gray-500">
                        {doc.page_count} pages
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Main Content Area */}
          <div className="lg:col-span-3 bg-white rounded-lg shadow">
            {selectedDoc ? (
              <>
                {/* Tabs */}
                <div className="border-b border-gray-200">
                  <nav className="flex -mb-px">
                    <button
                      onClick={() => setActiveTab('chat')}
                      className={`px-6 py-3 text-sm font-medium ${
                        activeTab === 'chat'
                          ? 'border-b-2 border-blue-500 text-blue-600'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      <MessageSquare className="w-4 h-4 inline mr-2" />
                      Chat
                    </button>
                    <button
                      onClick={() => setActiveTab('summary')}
                      className={`px-6 py-3 text-sm font-medium ${
                        activeTab === 'summary'
                          ? 'border-b-2 border-blue-500 text-blue-600'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      <FileText className="w-4 h-4 inline mr-2" />
                      Summary
                    </button>
                    <button
                      onClick={() => setActiveTab('analysis')}
                      className={`px-6 py-3 text-sm font-medium ${
                        activeTab === 'analysis'
                          ? 'border-b-2 border-blue-500 text-blue-600'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      <BarChart className="w-4 h-4 inline mr-2" />
                      Analysis
                    </button>
                  </nav>
                </div>

                {/* Tab Content */}
                <div className="p-6">
                  {activeTab === 'chat' && (
                    <div className="flex flex-col h-[600px]">
                      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
                        {messages.map((message, index) => (
                          <div
                            key={index}
                            className={`flex ${
                              message.role === 'user' ? 'justify-end' : 'justify-start'
                            }`}
                          >
                            <div
                              className={`max-w-[70%] p-4 rounded-lg ${
                                message.role === 'user'
                                  ? 'bg-blue-500 text-white'
                                  : 'bg-gray-100 text-gray-900'
                              }`}
                            >
                              <p className="whitespace-pre-wrap">{message.content}</p>
                              
                              {message.sources && message.sources.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-gray-300">
                                  <p className="text-xs font-semibold mb-2">Sources:</p>
                                  {message.sources.map((source, idx) => (
                                    <div key={idx} className="text-xs mb-1">
                                      <span className="font-medium">Page {source.page}:</span>
                                      <span className="ml-1">{source.content}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                        {isLoading && (
                          <div className="flex justify-start">
                            <div className="bg-gray-100 p-4 rounded-lg">
                              <Loader2 className="w-5 h-5 animate-spin" />
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={inputMessage}
                          onChange={(e) => setInputMessage(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                          placeholder="Ask about the document..."
                          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={isLoading}
                        />
                        <button
                          onClick={sendMessage}
                          disabled={isLoading || !inputMessage.trim()}
                          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Send className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {activeTab === 'summary' && (
                    <div className="space-y-6">
                      {isLoading ? (
                        <div className="flex justify-center py-12">
                          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                        </div>
                      ) : summary ? (
                        <>
                          <div>
                            <h3 className="text-lg font-semibold mb-3">Document Summary</h3>
                            <p className="text-gray-700 leading-relaxed">{summary.summary}</p>
                          </div>
                          
                          <div>
                            <h3 className="text-lg font-semibold mb-3">Key Points</h3>
                            <div className="text-gray-700 whitespace-pre-wrap">{summary.key_points}</div>
                          </div>
                        </>
                      ) : null}
                    </div>
                  )}

                  {activeTab === 'analysis' && (
                    <div className="space-y-6">
                      {isLoading ? (
                        <div className="flex justify-center py-12">
                          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                        </div>
                      ) : analysis ? (
                        <>
                          <h3 className="text-lg font-semibold mb-4">Document Analysis</h3>
                          {Object.entries(analysis.analysis).map(([question, answer]) => (
                            <div key={question} className="bg-gray-50 p-4 rounded-lg">
                              <h4 className="font-medium text-gray-900 mb-2">{question}</h4>
                              <p className="text-gray-700">{answer as string}</p>
                            </div>
                          ))}
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-[600px] text-gray-500">
                <div className="text-center">
                  <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <p>Upload a document to get started</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}