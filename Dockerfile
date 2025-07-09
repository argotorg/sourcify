FROM node:20.11.1

# install cargo and rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN rustc --version && cargo --version

# install iputils-ping
RUN apt-get update && \
    apt-get install -y iputils-ping && \
    rm -rf /var/lib/apt/lists/*

# set workspace
WORKDIR /verification

# install dependencies
COPY package*.json ./
RUN npm install

# compile
COPY . .
RUN npm run build

CMD ["node"]
