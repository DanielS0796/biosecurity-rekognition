# Lambda Module Resolution Fix

## Problem
Lambda function was throwing `RuntimeError: Cannot find module 'liveness'` due to incorrect zip structure.

## Solution
Recreated zip with `liveness.js` at root level instead of nested under `lambda/` directory.

## Deployment
Run in CloudShell:
```bash
aws lambda update-function-code \
  --function-name biosecurity-liveness \
  --zip-file fileb://lambda-liveness.zip \
  --region us-east-1
```
