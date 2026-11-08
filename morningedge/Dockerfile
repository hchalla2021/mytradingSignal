FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN groupadd --gid 2000 zerodha-share
RUN useradd --system --uid 10001 --groups zerodha-share appuser
RUN mkdir -p /run/shared && chown appuser:zerodha-share /run/shared && chmod 2770 /run/shared
USER appuser

EXPOSE 8010

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8010"]
