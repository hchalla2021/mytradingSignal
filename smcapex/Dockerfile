FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . /app/smcapex
EXPOSE 8014
CMD ["uvicorn", "smcapex.main:app", "--host", "0.0.0.0", "--port", "8014", "--workers", "1"]
