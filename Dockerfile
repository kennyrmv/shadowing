FROM node:22-alpine

# Install Python, pip, ffmpeg, and build deps for parselmouth
RUN apk add --no-cache python3 py3-pip ffmpeg

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm ci

# Install Python dependencies
COPY requirements.txt ./
RUN pip3 install -r requirements.txt --break-system-packages

# Copy source and build
COPY . .
RUN npm run build

EXPOSE 3000
ENV NODE_ENV=production

# Use entrypoint script to debug env vars
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh
CMD ["./entrypoint.sh"]
