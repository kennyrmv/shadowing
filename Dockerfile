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

# Copy source and build
COPY . .
RUN npm run build

EXPOSE 3000
ENV NODE_ENV=production
CMD ["npm", "start"]
