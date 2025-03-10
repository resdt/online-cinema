# Use Python 3.12
FROM python:3.12

# Set workspace
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc

# Set working directory
WORKDIR /app

# Copy application code
COPY . .

# Install dependencies
RUN pip install -r requirements.txt

# Expose the port the app will use
EXPOSE 8000

# Define the command to run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
