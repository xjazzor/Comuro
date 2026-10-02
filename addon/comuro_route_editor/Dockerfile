ARG BUILD_FROM=python:3.13-alpine
FROM ${BUILD_FROM}

WORKDIR /app

COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py /app/

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8099"]