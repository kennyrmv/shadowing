FROM node:22-alpine

# Install Python and pip
RUN apk add --no-cache python3 py3-pip

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm ci

# Install Python dependencies
COPY requirements.txt ./
RUN pip3 install -r requirements.txt --break-system-packages

# Declare build args so Railway passes env vars into the build
ARG WEBSHARE_PROXY_USER
ARG WEBSHARE_PROXY_PASS
ARG NEXT_PUBLIC_AZURE_SPEECH_KEY
ARG NEXT_PUBLIC_AZURE_SPEECH_REGION

# Make them available at runtime
ENV WEBSHARE_PROXY_USER=$WEBSHARE_PROXY_USER
ENV WEBSHARE_PROXY_PASS=$WEBSHARE_PROXY_PASS
ENV NEXT_PUBLIC_AZURE_SPEECH_KEY=$NEXT_PUBLIC_AZURE_SPEECH_KEY
ENV NEXT_PUBLIC_AZURE_SPEECH_REGION=$NEXT_PUBLIC_AZURE_SPEECH_REGION

# Copy source and build
COPY . .
RUN npm run build

EXPOSE 3000
ENV NODE_ENV=production
CMD ["npm", "start"]
