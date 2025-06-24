# syntax=docker/dockerfile:1

FROM node:20-alpine

WORKDIR /app

# Create files using printf to avoid heredoc issues
RUN printf '{\n  "name": "wp-wasm-demo",\n  "version": "1.0.0",\n  "type": "module",\n  "dependencies": {\n    "express": "^4.18.2"\n  }\n}' > package.json

RUN printf 'import express from "express";\n\nconst app = express();\nconst port = 8080;\n\napp.get("/", (req, res) => {\n  res.send("<h1>WordPress WASM Demo Server</h1><p>Server is running on port " + port + "</p>");\n});\n\napp.get("/info", (req, res) => {\n  res.json({\n    message: "WordPress WASM Demo Server",\n    platform: "Cloudflare Workers Compatible",\n    port: port\n  });\n});\n\napp.listen(port, "0.0.0.0", () => {\n  console.log("Server listening on port " + port);\n});' > server.js

RUN npm install

EXPOSE 8080

CMD ["node", "server.js"]