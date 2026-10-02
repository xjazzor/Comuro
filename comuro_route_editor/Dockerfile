ARG BUILD_FROM=python:3.13-alpine
FROM ${BUILD_FROM}

ARG BUILD_VERSION
ARG BUILD_ARCH

LABEL   io.hass.version="${BUILD_VERSION}"   io.hass.type="app"   io.hass.arch="${BUILD_ARCH}"

WORKDIR /app

COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py /app/

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8099"]
