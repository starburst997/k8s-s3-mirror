FROM node:20-alpine

WORKDIR /app

COPY package.json .
RUN npm install

COPY index.js .

# Create a script to wait for the proxy and run tests
RUN echo '#!/bin/sh' > /app/wait-and-test.sh && \
    echo 'echo "Waiting for S3 proxy to be ready..."' >> /app/wait-and-test.sh && \
    echo 'sleep 10' >> /app/wait-and-test.sh && \
    echo 'echo "Running S3 proxy tests..."' >> /app/wait-and-test.sh && \
    echo 'node index.js test "$@"' >> /app/wait-and-test.sh && \
    chmod +x /app/wait-and-test.sh

CMD ["sh", "-c", "echo 'Test client ready. Run: docker-compose run test-client /app/wait-and-test.sh <bucket-name>'"]