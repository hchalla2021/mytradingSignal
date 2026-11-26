FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py context.py external.py ./openingedge/
EXPOSE 8012
CMD ["uvicorn", "openingedge.main:app", "--host", "0.0.0.0", "--port", "8012"]
