FROM python:3.12-slim

WORKDIR /app

COPY data_pipeline/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY data_pipeline/ ./data_pipeline/
COPY frontend/public/data/ ./frontend/public/data/

CMD ["python", "data_pipeline/fetch_shelters.py"]
