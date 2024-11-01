
docker build -t api .
docker run -it --rm api /bin/bash

docker run -p 80:80 -p 443:443 api

docker-compose up --build api




