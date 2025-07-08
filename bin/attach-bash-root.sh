#!/bin/bash
set -e

# Launch the image and run interactive bash
echo "Launching spam-scanner container with interactive bash..."
docker exec -it --user root spam-scanner /bin/bash

# Note: The container will be removed when you exit the bash shell