.PHONY: help install-backend install-frontend install run-backend run-frontend run docker-build docker-up docker-down clean

help:
	@echo "Available commands:"
	@echo "  make install        - Install all dependencies"
	@echo "  make run            - Run both backend and frontend"
	@echo "  make run-backend    - Run backend only"
	@echo "  make run-frontend   - Run frontend only"
	@echo "  make docker-build   - Build Docker images"
	@echo "  make docker-up      - Start Docker containers"
	@echo "  make docker-down    - Stop Docker containers"
	@echo "  make clean          - Clean up generated files"

install-backend:
	cd backend && python -m venv venv && . venv/bin/activate && pip install -r requirements.txt

install-frontend:
	cd frontend && npm install

install: install-backend install-frontend

run-backend:
	cd backend && . venv/bin/activate && uvicorn main:app --reload

run-frontend:
	cd frontend && npm run dev

run:
	@echo "Starting backend and frontend..."
	@make run-backend & make run-frontend

docker-build:
	docker-compose build

docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	rm -rf backend/uploads/*
	rm -rf backend/chroma_db/*
	rm -rf frontend/.next
	rm -rf frontend/node_modules