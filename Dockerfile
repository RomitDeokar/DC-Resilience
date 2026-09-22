# Single-image build: compiled React app served by the FastAPI backend.
FROM node:20-alpine AS web
WORKDIR /app
COPY package*.json tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm ci && npm run build

FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
COPY data ./data
COPY --from=web /app/dist ./dist
EXPOSE 8000
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
