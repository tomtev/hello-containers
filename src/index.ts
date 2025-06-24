import { Container, loadBalance, getContainer } from "@cloudflare/containers";
import { Hono } from "hono";

export class MyContainer extends Container {
  // Port the container listens on (default: 8080)
  defaultPort = 8080;
  // Time before container sleeps due to inactivity (default: 30s)
  sleepAfter = "5m";
  // Environment variables passed to the container
  envVars = {
    MESSAGE: "WordPress with SQLite",
  };

  // Optional lifecycle hooks
  override onStart() {
    console.log("WordPress container successfully started");
  }

  override onStop() {
    console.log("WordPress container successfully shut down");
  }

  override onError(error: unknown) {
    console.log("WordPress container error:", error);
  }
}

// Create Hono app with proper typing for Cloudflare Workers
const app = new Hono<{
  Bindings: { MY_CONTAINER: DurableObjectNamespace<MyContainer> };
}>();

// Home route with available endpoints
app.get("/", (c) => {
  return c.text(
    "WordPress + SQLite on Cloudflare Containers\n\n" +
      "Available endpoints:\n" +
      "GET /wordpress/<ID> - Start a WordPress instance for each ID\n" +
      "GET /wp - Single WordPress instance\n" +
      "\nNote: Each container instance starts fresh. Data doesn't persist between restarts.",
  );
});

// Route requests to a specific WordPress container using the container ID
// This proxies ALL WordPress paths correctly
app.all("/wordpress/:id/*", async (c) => {
  const id = c.req.param("id");
  const container = getContainer(c.env.MY_CONTAINER, id);
  
  // Get the path after /wordpress/:id
  const path = c.req.path.replace(`/wordpress/${id}`, '') || '/';
  
  // Create a new request with the correct path for WordPress
  const url = new URL(c.req.url);
  url.pathname = path;
  
  const newRequest = new Request(url.toString(), {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
  });
  
  return await container.fetch(newRequest);
});

// Alternative: Single WordPress instance at /wp
app.all("/wp/*", async (c) => {
  const container = getContainer(c.env.MY_CONTAINER, "main");
  
  // Get the path after /wp
  const path = c.req.path.replace('/wp', '') || '/';
  
  // Create a new request with the correct path for WordPress
  const url = new URL(c.req.url);
  url.pathname = path;
  
  const newRequest = new Request(url.toString(), {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
  });
  
  return await container.fetch(newRequest);
});

export default app;
