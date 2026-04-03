FROM node:22-alpine

# Install Python, pip, ffmpeg, and build tools for parselmouth compilation
RUN apk add --no-cache python3 py3-pip ffmpeg \
    && apk add --no-cache --virtual .build-deps \
       build-base cmake ninja gcc g++ python3-dev

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm ci

# Install Python dependencies
COPY requirements.txt ./
RUN pip3 install -r requirements.txt --break-system-packages \
    && apk del .build-deps

# Copy source and build
COPY . .
RUN npm run build

EXPOSE 3000
ENV NODE_ENV=production

# Use entrypoint script to debug env vars
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh
CMD ["./entrypoint.sh"]
