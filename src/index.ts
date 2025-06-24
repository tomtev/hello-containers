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

// Helper function to clone request with body and proper headers
async function cloneRequestWithBody(req: Request, newUrl: string, pathPrefix: string = '') {
  // Read the body into an ArrayBuffer so it can be reused
  const body = req.body ? await req.arrayBuffer() : null;
  
  // Clone headers and add X-Forwarded headers
  const headers = new Headers(req.headers);
  const originalUrl = new URL(req.url);
  
  // Set forwarding headers so WordPress knows the real host
  headers.set('X-Forwarded-Host', originalUrl.host);
  headers.set('X-Forwarded-Proto', originalUrl.protocol.replace(':', ''));
  headers.set('X-Forwarded-For', headers.get('CF-Connecting-IP') || '127.0.0.1');
  
  // If we have a path prefix, set it so WordPress can use it
  if (pathPrefix) {
    headers.set('X-Forwarded-Prefix', pathPrefix);
  }
  
  console.log(`Forwarding request to container: ${newUrl} with prefix: ${pathPrefix}`);
  
  return new Request(newUrl, {
    method: req.method,
    headers: headers,
    body: body,
    // Important: don't set redirect mode to follow
    redirect: 'manual'
  });
}

// Helper function to rewrite HTML content to fix URLs
function rewriteHtmlUrls(html: string, pathPrefix: string, requestUrl: string): string {
  // Debug what we're rewriting
  console.log(`Rewriting HTML URLs with prefix: ${pathPrefix}`);
  
  const url = new URL(requestUrl);
  const baseUrl = `${url.protocol}//${url.host}`;
  
  // First, replace absolute URLs that point to our host but don't have the prefix
  // This handles cases like http://localhost:8788/wp-includes/...
  const absoluteUrlPattern = new RegExp(`${baseUrl}/(wp-[^"'\\s]*)`, 'g');
  html = html.replace(absoluteUrlPattern, (match, path) => {
    if (!match.includes(pathPrefix)) {
      console.log(`Rewriting absolute URL: ${match} -> ${baseUrl}${pathPrefix}/${path}`);
      return `${baseUrl}${pathPrefix}/${path}`;
    }
    return match;
  });
  
  // Rewrite form actions - be more aggressive
  html = html.replace(/action="(\/[^"]*)"/g, (match, url) => {
    console.log(`Rewriting form action: ${url} -> ${pathPrefix}${url}`);
    return `action="${pathPrefix}${url}"`;
  });
  html = html.replace(/action='(\/[^']*)'/g, `action='${pathPrefix}$1'`);
  
  // Also handle forms with no action or action=""
  html = html.replace(/action=""/g, `action="${pathPrefix}/"`);
  html = html.replace(/<form([^>]*?)>/g, (match, attrs) => {
    if (!attrs.includes('action=')) {
      console.log('Form without action attribute found, adding current path');
      return `<form${attrs} action="${pathPrefix}/">`;
    }
    return match;
  });
  
  // Rewrite href links (including link tags for CSS)
  html = html.replace(/href="(\/[^"]*)"/g, (match, url) => {
    console.log(`Rewriting href: ${url} -> ${pathPrefix}${url}`);
    return `href="${pathPrefix}${url}"`;
  });
  html = html.replace(/href='(\/[^']*)'/g, `href='${pathPrefix}$1'`);
  
  // Rewrite src attributes (including script tags)
  html = html.replace(/src="(\/[^"]*)"/g, (match, url) => {
    console.log(`Rewriting src: ${url} -> ${pathPrefix}${url}`);
    return `src="${pathPrefix}${url}"`;
  });
  html = html.replace(/src='(\/[^']*)'/g, `src='${pathPrefix}$1'`);
  
  // Also rewrite WordPress specific URL patterns that might appear in inline scripts
  // Look for patterns like: url: '/wp-admin/...'
  html = html.replace(/url:\s*["'](\/[^"']*?)["']/g, `url: "${pathPrefix}$1"`);
  
  // Rewrite ajaxurl if present
  html = html.replace(/ajaxurl\s*=\s*["'](\/[^"']*?)["']/g, `ajaxurl = "${pathPrefix}$1"`);
  
  // Rewrite any data-* attributes that contain URLs
  html = html.replace(/data-[^=]*="(\/[^"]*)"/g, (match, url) => {
    return match.replace(url, `${pathPrefix}${url}`);
  });
  
  // Handle WordPress REST API URLs
  html = html.replace(/["'](\/wp-json\/[^"']*)["']/g, `"${pathPrefix}$1"`);
  
  // Handle any JavaScript location redirects
  html = html.replace(/location\.href\s*=\s*["'](\/[^"']*)["']/g, `location.href = "${pathPrefix}$1"`);
  html = html.replace(/window\.location\s*=\s*["'](\/[^"']*)["']/g, `window.location = "${pathPrefix}$1"`);
  
  // Handle WordPress admin-ajax.php
  html = html.replace(/admin-ajax\.php/g, `${pathPrefix}/wp-admin/admin-ajax.php`);
  
  return html;
}

// Helper function to handle redirects properly
function handleRedirect(response: Response, requestUrl: string, pathPrefix: string): Response {
  const location = response.headers.get('location');
  if (!location) {
    return response;
  }
  
  let newLocation = location;
  const url = new URL(requestUrl);
  
  // Debug log
  console.log(`=== REDIRECT DEBUG ===`);
  console.log(`Original request URL: ${requestUrl}`);
  console.log(`Path prefix: ${pathPrefix}`);
  console.log(`Original redirect location: ${location}`);
  console.log(`Response status: ${response.status}`);
  
  // If it's an absolute URL with our host but missing the prefix
  if (location.startsWith(`${url.protocol}//${url.host}/`) && !location.includes(pathPrefix)) {
    // Extract the path from the absolute URL
    const redirectUrl = new URL(location);
    const redirectPath = redirectUrl.pathname;
    
    // If the path doesn't already include our prefix, add it
    if (!redirectPath.startsWith(pathPrefix)) {
      newLocation = `${url.protocol}//${url.host}${pathPrefix}${redirectPath}${redirectUrl.search}${redirectUrl.hash}`;
      console.log(`Matched absolute URL with our host, adding prefix`);
    }
  }
  // If it's an absolute URL with http://container, replace it
  else if (location.startsWith('http://container')) {
    newLocation = location.replace('http://container', `${url.protocol}//${url.host}${pathPrefix}`);
    console.log(`Matched http://container pattern`);
  } 
  // If it's a protocol-relative URL
  else if (location.startsWith('//')) {
    newLocation = `${url.protocol}${location}`;
    console.log(`Matched protocol-relative pattern`);
  }
  // If it's a relative URL starting with /, add our prefix
  else if (location.startsWith('/')) {
    newLocation = `${pathPrefix}${location}`;
    console.log(`Matched root-relative pattern`);
  }
  // If it's a relative URL not starting with /, make it relative to current path
  else if (!location.includes('://')) {
    // Get the current path without the file
    const currentPath = url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1);
    newLocation = currentPath + location;
    console.log(`Matched relative pattern, current path: ${currentPath}`);
  }
  
  console.log(`Rewritten redirect location: ${newLocation}`);
  console.log(`=== END REDIRECT DEBUG ===`);
  
  // Return new response with updated location
  const newHeaders = new Headers(response.headers);
  newHeaders.set('location', newLocation);
  
  return new Response(response.body, {
    status: response.status,
    headers: newHeaders
  });
}

// Home route with available endpoints
app.get("/", (c) => {
  return c.text(
    "WordPress + SQLite on Cloudflare Containers\n\n" +
      "Available endpoints:\n" +
      "GET /wordpress/<ID> - Start a WordPress instance for each ID\n" +
      "GET /wp - Single WordPress instance\n" +
      "\nExamples:\n" +
      "- http://localhost:8788/wordpress/test\n" +
      "- http://localhost:8788/wordpress/demo\n" +
      "- http://localhost:8788/wordpress/client1\n" +
      "\nNote: Each container instance starts fresh. Data doesn't persist between restarts.",
  );
});

// Route ALL requests under /wordpress/:id to the container
app.all("/wordpress/:id", async (c) => {
  const id = c.req.param("id");
  const container = getContainer(c.env.MY_CONTAINER, id);
  const pathPrefix = `/wordpress/${id}`;
  
  console.log(`\n>>> Handling request for container ${id}: ${c.req.url}`);
  
  // Clone the request with body
  const newRequest = await cloneRequestWithBody(c.req.raw, "http://container/", pathPrefix);
  const response = await container.fetch(newRequest);
  
  console.log(`Container response status: ${response.status}`);
  
  // Handle redirects manually
  if (response.status >= 300 && response.status < 400) {
    return handleRedirect(response, c.req.url, pathPrefix);
  }
  
  // If it's an HTML response, rewrite URLs in the content
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    const html = await response.text();
    const rewrittenHtml = rewriteHtmlUrls(html, pathPrefix, c.req.url);
    
    return new Response(rewrittenHtml, {
      status: response.status,
      headers: response.headers
    });
  }
  
  return response;
});

app.all("/wordpress/:id/*", async (c) => {
  const id = c.req.param("id");
  const container = getContainer(c.env.MY_CONTAINER, id);
  const pathPrefix = `/wordpress/${id}`;
  
  // Get the path after /wordpress/:id
  const fullPath = c.req.path;
  const path = fullPath.substring(pathPrefix.length) || '/';
  
  // Get query string
  const url = new URL(c.req.url);
  const queryString = url.search;
  
  console.log(`\n>>> Handling sub-path request for container ${id}: ${c.req.url}`);
  console.log(`Method: ${c.req.method}`);
  console.log(`Extracted path: ${path}`);
  console.log(`Query string: ${queryString}`);
  
  // For POST requests, log form data
  if (c.req.method === 'POST') {
    const contentType = c.req.header('content-type') || '';
    console.log(`POST Content-Type: ${contentType}`);
    
    // Clone the request to read the body without consuming it
    const clonedReq = c.req.raw.clone();
    if (contentType.includes('application/x-www-form-urlencoded')) {
      try {
        const formData = await clonedReq.formData();
        console.log('POST Form Data:');
        for (const [key, value] of formData.entries()) {
          console.log(`  ${key}: ${value}`);
        }
      } catch (e) {
        console.log('Could not parse form data:', e);
      }
    }
  }
  
  // Clone the request with body - include query string
  const newRequest = await cloneRequestWithBody(c.req.raw, `http://container${path}${queryString}`, pathPrefix);
  const response = await container.fetch(newRequest);
  
  console.log(`Container response status: ${response.status}`);
  console.log(`Container response headers:`, Object.fromEntries(response.headers.entries()));
  
  // Handle redirects manually
  if (response.status >= 300 && response.status < 400) {
    return handleRedirect(response, c.req.url, pathPrefix);
  }
  
  // If it's an HTML response, rewrite URLs in the content
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    const html = await response.text();
    
    // For debugging, check if this looks like a success or error page
    if (c.req.method === 'POST') {
      if (html.includes('Success') || html.includes('success')) {
        console.log('Response appears to contain success message');
      }
      if (html.includes('Error') || html.includes('error')) {
        console.log('Response appears to contain error message');
      }
      // Log a snippet of the response for debugging
      const snippet = html.substring(0, 500).replace(/\s+/g, ' ');
      console.log(`Response HTML snippet: ${snippet}...`);
    }
    
    const rewrittenHtml = rewriteHtmlUrls(html, pathPrefix, c.req.url);
    
    return new Response(rewrittenHtml, {
      status: response.status,
      headers: response.headers
    });
  }
  
  return response;
});

// Alternative: Single WordPress instance at /wp
app.all("/wp", async (c) => {
  const container = getContainer(c.env.MY_CONTAINER, "main");
  const pathPrefix = '/wp';
  
  const newRequest = await cloneRequestWithBody(c.req.raw, "http://container/", pathPrefix);
  const response = await container.fetch(newRequest);
  
  // Handle redirects
  if (response.status >= 300 && response.status < 400) {
    return handleRedirect(response, c.req.url, pathPrefix);
  }
  
  // If it's an HTML response, rewrite URLs in the content
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    const html = await response.text();
    const rewrittenHtml = rewriteHtmlUrls(html, pathPrefix, c.req.url);
    
    return new Response(rewrittenHtml, {
      status: response.status,
      headers: response.headers
    });
  }
  
  return response;
});

app.all("/wp/*", async (c) => {
  const container = getContainer(c.env.MY_CONTAINER, "main");
  const pathPrefix = '/wp';
  
  // Get the path after /wp
  const path = c.req.path.substring(3) || '/';
  
  const newRequest = await cloneRequestWithBody(c.req.raw, `http://container${path}`, pathPrefix);
  const response = await container.fetch(newRequest);
  
  // Handle redirects
  if (response.status >= 300 && response.status < 400) {
    return handleRedirect(response, c.req.url, pathPrefix);
  }
  
  // If it's an HTML response, rewrite URLs in the content
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    const html = await response.text();
    const rewrittenHtml = rewriteHtmlUrls(html, pathPrefix, c.req.url);
    
    return new Response(rewrittenHtml, {
      status: response.status,
      headers: response.headers
    });
  }
  
  return response;
});

// Handle WordPress assets for specific container instances
app.all("/wordpress/:id/wp-includes/*", async (c) => {
  const id = c.req.param("id");
  const container = getContainer(c.env.MY_CONTAINER, id);
  const pathPrefix = `/wordpress/${id}`;
  const path = c.req.path.substring(pathPrefix.length);
  
  const newRequest = await cloneRequestWithBody(c.req.raw, `http://container${path}`, pathPrefix);
  return await container.fetch(newRequest);
});

app.all("/wordpress/:id/wp-admin/*", async (c) => {
  const id = c.req.param("id");
  const container = getContainer(c.env.MY_CONTAINER, id);
  const pathPrefix = `/wordpress/${id}`;
  const path = c.req.path.substring(pathPrefix.length);
  
  const newRequest = await cloneRequestWithBody(c.req.raw, `http://container${path}`, pathPrefix);
  const response = await container.fetch(newRequest);
  
  // Rewrite HTML for admin pages too
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    const html = await response.text();
    const rewrittenHtml = rewriteHtmlUrls(html, pathPrefix, c.req.url);
    
    return new Response(rewrittenHtml, {
      status: response.status,
      headers: response.headers
    });
  }
  
  return response;
});

app.all("/wordpress/:id/wp-content/*", async (c) => {
  const id = c.req.param("id");
  const container = getContainer(c.env.MY_CONTAINER, id);
  const pathPrefix = `/wordpress/${id}`;
  const path = c.req.path.substring(pathPrefix.length);
  
  const newRequest = await cloneRequestWithBody(c.req.raw, `http://container${path}`, pathPrefix);
  return await container.fetch(newRequest);
});

// Catch-all routes for WordPress core assets without container prefix
// These will route to the "main" container for now
app.all("/wp-includes/*", async (c) => {
  console.log(`WARNING: Asset requested without container prefix: ${c.req.path}`);
  console.log(`This suggests HTML rewriting missed some URLs`);
  
  // For now, route to main container, but this isn't ideal for multi-container setup
  const container = getContainer(c.env.MY_CONTAINER, "main");
  const newRequest = await cloneRequestWithBody(c.req.raw, `http://container${c.req.path}`);
  return await container.fetch(newRequest);
});

app.all("/wp-admin/*", async (c) => {
  console.log(`WARNING: Asset requested without container prefix: ${c.req.path}`);
  
  const container = getContainer(c.env.MY_CONTAINER, "main");
  const newRequest = await cloneRequestWithBody(c.req.raw, `http://container${c.req.path}`);
  return await container.fetch(newRequest);
});

app.all("/wp-content/*", async (c) => {
  console.log(`WARNING: Asset requested without container prefix: ${c.req.path}`);
  
  const container = getContainer(c.env.MY_CONTAINER, "main");
  const newRequest = await cloneRequestWithBody(c.req.raw, `http://container${c.req.path}`);
  return await container.fetch(newRequest);
});

export default app;
