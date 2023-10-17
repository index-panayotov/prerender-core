const puppeteer = require("puppeteer");
const crypto = require("crypto");
const fs = require("fs");
const urlParser = require("url");
const MongoClient = require("mongodb").MongoClient;
const { PurgeCSS } = require("purgecss");
const prettier = require("prettier");
// const purgeFromHTML = require("purge-from-html");
const { JSDOM } = require("jsdom");
// MongoDB connection URL
const dbUrl = "mongodb://admin:adminpassword@localhost:27017/";

// Database and collection names
const dbName = "prerender";
const collectionName = "tobescanned";
const cachedCollectionName = "cachedWebpages";
const seoCollectionName = "seoScore"; // New collection for SEO data


// Puppeteer options
const puppeteerOptions = {
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
};

async function removeTag(html, tag) {
  const dom = new JSDOM(html);
  const { document } = dom.window;

  // Remove script tags
  const scriptTags = document.getElementsByTagName(tag);
  for (let i = scriptTags.length - 1; i >= 0; i--) {
    scriptTags[i].parentNode.removeChild(scriptTags[i]);
  }

  // Return the updated HTML content
  return document.documentElement.outerHTML;
}
async function removeJavaScript(html) {
  return removeTag(html, "script");
}
async function removeLink(html) {
  return removeTag(html, "link");
}

async function getCSSContent(page, url) {
  // Extract the base URL without query parameters
  const parsedUrl = urlParser.parse(url);
  const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`;

  // Get the CSS links' href attribute values
  const cssLinks = await page.$$eval("link[rel=stylesheet]", (links) =>
    links.map((link) => link.href)
  );

  // Fetch and concatenate the CSS content into a single line
  let cssContent = "";
  for (const link of cssLinks) {
    const absoluteUrl = new URL(link, baseUrl).href;
    const response = await page.evaluate(async (url) => {
      const response = await fetch(url);
      return response.text();
    }, absoluteUrl);
    cssContent += response.replace(/\n/g, "").replace(/\s+/g, " ");
  }

  return cssContent;
}

async function removeUnusedCSS(html, cssContent) {
  return cssContent;
  const purgeCSSResult = await new PurgeCSS().purge({
    content: [{ raw: html, extension: "html" }],
    css: [{ raw: cssContent }],
    defaultExtractor: (content) => content.match(/[\w-/:]+(?<!:)/g) || [],
    // fontFace: true,
    // keyframes: true,
    // extractors: [
    //   {
    //     extractor: purgeFromHTML,
    //     extensions: ["html"],
    //   },
    // ],
  });

  return purgeCSSResult[0].css;
}

async function main() {
  try {
    // Connect to MongoDB
    const client = await MongoClient.connect(dbUrl);
    const db = client.db(dbName);
    const collection = db.collection(collectionName);
    const cachedCollection = db.collection(cachedCollectionName);
    const seoCollection = db.collection(seoCollectionName); // New collection for SEO data


    // Retrieve documents from the collection
    const documents = await collection.find({}).toArray();

    // Launch Puppeteer
    const browser = await puppeteer.launch(puppeteerOptions);

    // Process each document
    for (const document of documents) {
      const url = document.loc[0];
      console.log("url:", url);

      // Create a new page
      const page = await browser.newPage();

      // Navigate to the URL and wait for the page to fully load
      const response = await page.goto(url, { waitUntil: "networkidle2" });
      // Check the response status code
      if (response.status() !== 200) {
        console.log(
          `Error: Received ${response.status()} status code for URL: ${url}`
        );
        await page.close();
        continue;
      }
      // Get the HTML content
      const html = await page.evaluate(() => {
        // Remove JavaScript from the HTML content
        const scriptTags = document.getElementsByTagName("script");
        for (let i = scriptTags.length - 1; i >= 0; i--) {
          scriptTags[i].parentNode.removeChild(scriptTags[i]);
        }
        const elements = document.querySelectorAll("*");
        for (let i = 0; i < elements.length; i++) {
          const attributes = elements[i].attributes;
          for (let j = attributes.length - 1; j >= 0; j--) {
            const attributeName = attributes[j].name.toLowerCase();
            if (attributeName.startsWith("on")) {
              elements[i].removeAttribute(attributeName);
            }
          }
        }
        return document.documentElement.outerHTML;
      });

      // Format the HTML code
      const formattedHtml = html; //prettier.format(html, { parser: "html" });
      // Get the CSS content
      const cssContent = await getCSSContent(page, url);

      // Remove unused CSS
      const modifiedCSS = await removeUnusedCSS(formattedHtml, cssContent);

      // Inject the CSS content into the HTML
      const modifiedHtml = await removeJavaScript(
        formattedHtml.replace("</head>", `<style>${modifiedCSS}</style></head>`)
      );

      // Generate the SHA256 hash of the URL
      const hash = crypto.createHash("sha256").update(url).digest("hex");

      // Save the modified HTML content to a file
      const filePath = `./cache/${hash}.html`;
      fs.writeFileSync(filePath, modifiedHtml);

      console.log(`HTML saved for URL: ${url}`);
    //   console.log(`File saved at: ${filePath}`);

      // Insert the record into the "cachedWebpages" collection
      await cachedCollection.insertOne({ loc: url, hash });

      // Close the page
      await page.close();
    }

    // Close Puppeteer and MongoDB connections
    await browser.close();
    await client.close();
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

// Start the script
main();
