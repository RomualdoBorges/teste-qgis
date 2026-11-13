FROM postgres:16
# PostGIS + extensões usadas pelo dump (pgrouting, http)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      postgresql-16-postgis-3 postgresql-16-postgis-3-scripts \
      postgresql-16-postgis-tiger-geocoder postgresql-16-pgrouting postgresql-16-http \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY init/ /docker-entrypoint-initdb.d/
COPY sql/ /docker-entrypoint-sql/
