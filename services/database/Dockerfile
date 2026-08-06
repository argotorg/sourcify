FROM postgres:15-bookworm@sha256:b0c5bab0fbba8e0c221f73b1dc6359ec35f8650074377e727299df248fc8ad51

RUN apt-get update && \
    apt-get -y install postgresql-15-cron && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
