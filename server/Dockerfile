FROM python:3.11-slim
WORKDIR /app
COPY pyproject.toml ./
COPY parda_server ./parda_server
RUN pip install --no-cache-dir . && useradd -r -u 10001 parda
USER parda
ENV PARDA_PROVIDER=vllm
EXPOSE 8000
CMD ["uvicorn", "parda_server.app:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
