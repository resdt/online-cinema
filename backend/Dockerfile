# Use Python 3.12
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

# Set working directory
WORKDIR /app/backend

# Copy application code
COPY . /app/backend

# Install dependencies
RUN uv sync --frozen --no-dev

# Expose the port the app will use
EXPOSE 8000

# Define the command to run the application
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
