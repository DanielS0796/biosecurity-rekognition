#!/bin/bash
cd /home/claude/biosecurity-rekognition
aws lambda update-function-code \
  --function-name biosecurity-liveness \
  --zip-file fileb://lambda-liveness.zip \
  --region us-east-1
echo "Testing liveness-init endpoint..."
curl -X POST https://4lq3kxldzc.execute-api.us-east-1.amazonaws.com/prod/liveness-init \
  -H "Content-Type: application/json" -d '{}'
