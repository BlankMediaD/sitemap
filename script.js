document.addEventListener('DOMContentLoaded', () => {
    const fetchButton = document.getElementById('fetchButton');
    const websiteUrlInput = document.getElementById('websiteUrl');
    const sitemapUrlInput = document.getElementById('sitemapUrl');
    const resultsContainer = document.getElementById('results-container');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageDiv = document.getElementById('error-message');
    const errorTextSpan = document.getElementById('error-text');
    const copyAllButton = document.getElementById('copyAllButton');

    let allFetchedUrls = []; // To store all URLs for the "Copy All" button

    // Define categories and their keywords for segregation
    const categories = {
        Products: ['/product', '/products/', '/item/', '/detail/'],
        Posts: ['/post/', '/posts/', '/article/', '/articles/'],
        Blogs: ['/blog/', '/blogs/'],
        Pages: ['/page/', '/pages/'],
    };
    const OTHER_CATEGORY = "Other Links";

    if (fetchButton) {
        fetchButton.addEventListener('click', async () => {
            hideError();
            resultsContainer.innerHTML = '';
            allFetchedUrls = []; // Reset for new fetch
            copyAllButton.style.display = 'none'; // Hide copy all button initially
            loadingIndicator.style.display = 'block';

            const directSitemapUrl = sitemapUrlInput.value.trim();
            const siteUrl = websiteUrlInput.value.trim();

            if (!directSitemapUrl && !siteUrl) {
                showError("Please provide either a Website URL or a Direct Sitemap URL.");
                loadingIndicator.style.display = 'none';
                return;
            }

            try {
                let sitemapUrlToFetch = directSitemapUrl;

                if (!sitemapUrlToFetch && siteUrl) {
                    sitemapUrlToFetch = await findSitemapUrl(siteUrl);
                    if (!sitemapUrlToFetch) {
                        showError("Could not automatically find a sitemap URL from the website. Please provide a direct sitemap URL if you know it.");
                        loadingIndicator.style.display = 'none';
                        return;
                    }
                    // Optionally, update the sitemapUrlInput with the found URL
                    // sitemapUrlInput.value = sitemapUrlToFetch;
                    console.log("Discovered sitemap URL:", sitemapUrlToFetch)
                } else if (!sitemapUrlToFetch && !siteUrl) {
                    // This case is already handled by the initial check, but being explicit.
                    showError("Please provide either a Website URL or a Direct Sitemap URL.");
                    loadingIndicator.style.display = 'none';
                    return;
                }

                try {
                    new URL(sitemapUrlToFetch);
                } catch (e) {
                    showError(`Invalid Sitemap URL: ${sitemapUrlToFetch}. Please enter a valid URL starting with http:// or https://`);
                    loadingIndicator.style.display = 'none';
                    return;
                }

                // Reset allFetchedUrls before starting new processing
                allFetchedUrls = [];
                await processSitemap(sitemapUrlToFetch); // Initial call

                if (allFetchedUrls.length > 0) {
                    displayCategorizedUrls(allFetchedUrls);
                    copyAllButton.style.display = 'block';
                } else {
                    resultsContainer.innerHTML = '<p>No URLs found after processing the sitemap(s).</p>';
                    copyAllButton.style.display = 'none';
                }

            } catch (error) // Catches errors from findSitemapUrl or initial processSitemap call
            {
                console.error("Overall processing error:", error);
                // showError is likely called within processSitemap for specific fetch/parse errors.
                // This is a fallback or for errors outside that scope.
                if (errorMessageDiv.style.display === 'none') { // Show error only if not already shown
                    showError(`An error occurred: ${error.message}.`);
                }
                allFetchedUrls = [];
                copyAllButton.style.display = 'none';
            } finally {
                loadingIndicator.style.display = 'none';
            }
        });
    }


    // New function to process a sitemap URL (can be an index or a regular sitemap)
    // Recursively calls itself if it finds a sitemap index.
    // Appends found page URLs to the global allFetchedUrls array.
    async function processSitemap(sitemapUrl) {
        console.log(`Processing sitemap: ${sitemapUrl}`);
        loadingIndicator.innerHTML = `<p>Processing: ${sitemapUrl}</p>`; // Update loading indicator

        try {
            new URL(sitemapUrl); // Validate URL format
        } catch (e) {
            // If a sub-sitemap URL from an index is invalid, we should record this.
            recordError(`Invalid sitemap URL encountered during processing: ${sitemapUrl}`);
            console.error(`Skipping invalid sitemap URL: ${sitemapUrl}`);
            return;
        }

        try {
            const response = await fetch(sitemapUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
            }

            const xmlText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "application/xml");

            const parserError = xmlDoc.getElementsByTagName("parsererror");
            if (parserError.length > 0) {
                console.error(`XML Parsing Error for ${sitemapUrl}:`, parserError[0].textContent);
                if (sitemapUrl.toLowerCase().endsWith('.gz')) {
                    throw new Error(`Failed to parse XML for ${sitemapUrl}. Compressed sitemaps (.gz) need to be uncompressed first. Please provide a URL to an uncompressed XML sitemap.`);
                }
                throw new Error(`Failed to parse XML for ${sitemapUrl}. Ensure it's a valid XML sitemap.`);
            }

            // Check if it's a sitemap index file (contains <sitemap> tags)
            const sitemapElements = xmlDoc.getElementsByTagName("sitemap");
            if (sitemapElements.length > 0) {
                console.log(`${sitemapUrl} is a sitemap index. Processing sub-sitemaps...`);
                const subSitemapUrls = [];
                for (let i = 0; i < sitemapElements.length; i++) {
                    const locElement = sitemapElements[i].getElementsByTagName("loc")[0];
                    if (locElement && locElement.textContent) {
                        let subSitemapPath = locElement.textContent.trim();
                        try {
                            // Resolve subSitemapPath against the current sitemapUrl (which is the index)
                            const absoluteSubSitemapUrl = new URL(subSitemapPath, sitemapUrl).href;
                            subSitemapUrls.push(absoluteSubSitemapUrl);
                        } catch (e) {
                            recordError(`Invalid sub-sitemap URL '${subSitemapPath}' found in index '${sitemapUrl}'.`);
                            console.error(`Could not resolve sub-sitemap URL '${subSitemapPath}' relative to '${sitemapUrl}'.`, e);
                        }
                    }
                }

                // Sequentially process each resolved sub-sitemap URL
                for (const absoluteSubUrl of subSitemapUrls) {
                    await processSitemap(absoluteSubUrl); // Recursive call
                }
            } else {
                // It's a regular sitemap file (contains <url> tags)
                const urlElements = xmlDoc.getElementsByTagName("url");
                let countInThisSitemap = 0;
                for (let i = 0; i < urlElements.length; i++) {
                    const locElement = urlElements[i].getElementsByTagName("loc")[0];
                    if (locElement && locElement.textContent) {
                        allFetchedUrls.push(locElement.textContent.trim());
                        countInThisSitemap++;
                    }
                }
                console.log(`Found ${countInThisSitemap} URLs in ${sitemapUrl}`);
            }
        } catch (error) {
            console.error(`Error processing sitemap ${sitemapUrl}:`, error);
            recordError(`Error with sitemap ${sitemapUrl}: ${error.message}. Some links might be missing.`);
        }
    }

    let errorList = []; // To accumulate errors

    if (fetchButton) {
        fetchButton.addEventListener('click', async () => {
            hideError(); // Clear previous single error message
            errorList = []; // Clear accumulated errors
            resultsContainer.innerHTML = '';
            allFetchedUrls = [];
            copyAllButton.style.display = 'none';
            loadingIndicator.style.display = 'block';
            loadingIndicator.innerHTML = '<p>Starting...</p>'; // Initial loading message

            const directSitemapUrl = sitemapUrlInput.value.trim();
            const siteUrl = websiteUrlInput.value.trim();

            if (!directSitemapUrl && !siteUrl) {
                showError("Please provide either a Website URL or a Direct Sitemap URL.");
                loadingIndicator.style.display = 'none';
                return;
            }

            try {
                let sitemapUrlToFetch = directSitemapUrl;

                if (!sitemapUrlToFetch && siteUrl) {
                    loadingIndicator.innerHTML = '<p>Searching for sitemap...</p>';
                    sitemapUrlToFetch = await findSitemapUrl(siteUrl);
                    if (!sitemapUrlToFetch) {
                        recordError("Could not automatically find a sitemap URL from the website. Please provide a direct sitemap URL if you know it.");
                        // No need to return yet, will be handled by allFetchedUrls.length check
                    } else {
                        console.log("Discovered sitemap URL:", sitemapUrlToFetch);
                         // sitemapUrlInput.value = sitemapUrlToFetch; // Optionally update input
                    }
                }

                if (sitemapUrlToFetch) {
                    try {
                        new URL(sitemapUrlToFetch);
                    } catch (e) {
                        recordError(`Invalid Sitemap URL: ${sitemapUrlToFetch}. Please enter a valid URL.`);
                        sitemapUrlToFetch = null; // Prevent processing
                    }
                } else if (!directSitemapUrl && siteUrl && !sitemapUrlToFetch) {
                    // This means findSitemapUrl failed and we already recorded an error.
                    // No further action needed here, will be caught by results display logic.
                }
                 else if (!sitemapUrlToFetch && !siteUrl) { // Should be caught earlier
                    recordError("Please provide either a Website URL or a Direct Sitemap URL.");
                }


                if (sitemapUrlToFetch) {
                    allFetchedUrls = [];
                    await processSitemap(sitemapUrlToFetch);
                }

                if (allFetchedUrls.length > 0) {
                    displayCategorizedUrls(allFetchedUrls);
                    copyAllButton.style.display = 'block';
                } else {
                    if (errorList.length === 0) { // If no specific errors, but also no URLs
                        recordError('No URLs found after processing the sitemap(s). This could be due to an empty sitemap or an issue not caught.');
                    }
                    resultsContainer.innerHTML = '<p>No URLs found. Check error messages below (if any).</p>';
                    copyAllButton.style.display = 'none';
                }

            } catch (error) {
                console.error("Overall processing error:", error);
                recordError(`A critical error occurred: ${error.message}.`);
                allFetchedUrls = [];
                copyAllButton.style.display = 'none';
            } finally {
                loadingIndicator.style.display = 'none';
                displayAccumulatedErrors(); // Display any recorded errors
            }
        });
    }


    if (copyAllButton) {
        copyAllButton.addEventListener('click', (event) => {
            if (allFetchedUrls.length > 0) {
                copyToClipboard(allFetchedUrls.join('\n'), event.target);
            } else {
                alert("No URLs to copy."); // Or use a more integrated notification
            }
        });
    }

    function copyToClipboard(text, buttonElement) {
        navigator.clipboard.writeText(text).then(() => {
            const originalText = buttonElement.textContent;
            buttonElement.textContent = 'Copied!';
            buttonElement.classList.add('copied');
            setTimeout(() => {
                buttonElement.textContent = originalText;
                buttonElement.classList.remove('copied');
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy: ', err);
            recordError('Failed to copy links to clipboard. Your browser might not support this feature or has restrictions.');
            displayAccumulatedErrors();
        });
    }

    function categorizeUrl(url) {
        try {
            const path = new URL(url).pathname.toLowerCase();
            for (const category in categories) {
                for (const keyword of categories[category]) {
                    if (path.includes(keyword)) {
                        return category;
                    }
                }
            }
        } catch (e) {
            console.warn(`Could not parse URL for categorization: ${url}`, e);
        }
        try {
            const path = new URL(url).pathname;
            if (path === '/' || path === '/index.html' || path === '/index.htm' || path === '/home/') {
                return 'Pages';
            }
        } catch (e) { /* ignore */ }
        return OTHER_CATEGORY;
    }

    function displayCategorizedUrls(urls) {
        resultsContainer.innerHTML = ''; // Clear previous results explicitly
        const categorizedUrls = {};
        urls.forEach(url => {
            const category = categorizeUrl(url);
            if (!categorizedUrls[category]) {
                categorizedUrls[category] = [];
            }
            categorizedUrls[category].push(url);
        });

        const totalLinksHeader = document.createElement('h3');
        totalLinksHeader.textContent = `Total Links Found: ${urls.length}`;
        resultsContainer.appendChild(totalLinksHeader);

        const displayOrder = [...Object.keys(categories), OTHER_CATEGORY];

        displayOrder.forEach(categoryName => {
            if (categorizedUrls[categoryName] && categorizedUrls[categoryName].length > 0) {
                const section = document.createElement('div');
                section.className = 'category-section';

                const title = document.createElement('h2');
                title.textContent = `${categoryName} (${categorizedUrls[categoryName].length})`;
                title.setAttribute('data-category-name', categoryName);
                section.appendChild(title);

                const ul = document.createElement('ul');
                categorizedUrls[categoryName].forEach(urlText => { // Renamed url to urlText for clarity
                    const li = document.createElement('li');
                    const a = document.createElement('a');
                    a.href = urlText;
                    a.textContent = urlText;
                    a.target = "_blank";
                    li.appendChild(a);
                    ul.appendChild(li);
                });
                section.appendChild(ul);

                const copyCategoryButton = document.createElement('button');
                copyCategoryButton.textContent = `Copy ${categoryName} Links`;
                copyCategoryButton.className = 'copy-button';
                copyCategoryButton.addEventListener('click', (event) => {
                    copyToClipboard(categorizedUrls[categoryName].join('\n'), event.target);
                });
                section.appendChild(copyCategoryButton);
                resultsContainer.appendChild(section);
            }
        });
        // The explicit if block for OTHER_CATEGORY after the loop is removed
        // as it's now correctly handled by being part of displayOrder.
    }

    async function findSitemapUrl(websiteUrl) {
        // Ensure websiteUrl ends with a slash for proper joining with robots.txt
        const baseUrl = websiteUrl.endsWith('/') ? websiteUrl : `${websiteUrl}/`;
        const robotsUrl = new URL('robots.txt', baseUrl).href;

        try {
            console.log(`Attempting to fetch robots.txt from: ${robotsUrl}`);
            const response = await fetch(robotsUrl);
            if (response.ok) {
                const robotsText = await response.text();
                const lines = robotsText.split('\n');
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (trimmedLine.toLowerCase().startsWith('sitemap:')) {
                        const sitemapUrl = trimmedLine.substring('sitemap:'.length).trim();
                        if (sitemapUrl) {
                            console.log(`Found sitemap in robots.txt: ${sitemapUrl}`);
                            // Validate if the found URL is absolute, if not, resolve it relative to the websiteUrl
                            try {
                                return new URL(sitemapUrl).href;
                            } catch (e) {
                                // If sitemapUrl is relative, resolve it against the original websiteUrl
                                return new URL(sitemapUrl, websiteUrl).href;
                            }
                        }
                    }
                }
            } else {
                console.warn(`Failed to fetch robots.txt: ${response.status} ${response.statusText}`);
            }
        } catch (error) {
            console.warn(`Error fetching or parsing robots.txt from ${robotsUrl}:`, error);
        }

        // If not found in robots.txt, try common paths
        const commonPaths = [
            'sitemap.xml',
            'sitemap_index.xml',
            'sitemap.php', // Some CMS might generate sitemaps this way
            'sitemap.xml.gz', // Less common for direct fetch, but good to be aware
            'sitemap-index.xml',
            'sitemapindex.xml',
            'sitemap.txt', // Simple text sitemap
            'google-sitemap.xml', // Older common name
            'sitemap/', // Sometimes it's a directory listing or default file
        ];

        console.log("robots.txt did not yield a sitemap or failed to fetch. Trying common paths...");
        for (const path of commonPaths) {
            const potentialSitemapUrl = new URL(path, baseUrl).href;
            try {
                console.log(`Trying common path: ${potentialSitemapUrl}`);
                // Using GET instead of HEAD as HEAD can be unreliable due to CORS or server misconfiguration for HEAD requests
                const response = await fetch(potentialSitemapUrl, { method: 'GET' });
                if (response.ok) {
                     // Check content type if possible, though response.ok is a strong indicator
                    const contentType = response.headers.get("content-type");
                    if (contentType && (contentType.includes("xml") || contentType.includes("text/plain") || contentType.includes("application/gzip"))) {
                        console.log(`Found sitemap at common path: ${potentialSitemapUrl} with Content-Type: ${contentType}`);
                        return potentialSitemapUrl;
                    } else if (!contentType) {
                        // If content type is not available, but response is ok, it's worth trying
                        console.log(`Found potential sitemap at common path (no content-type): ${potentialSitemapUrl}`);
                        return potentialSitemapUrl;
                    }
                }
            } catch (error) {
                console.warn(`Error trying common path ${potentialSitemapUrl}:`, error);
            }
        }

        console.log("Could not find sitemap URL through robots.txt or common paths.");
        return null; // No sitemap found
    }


    function showError(message) {
        errorTextSpan.textContent = message;
        errorMessageDiv.style.display = 'block';
        resultsContainer.innerHTML = '';
        copyAllButton.style.display = 'none';
    }

    function hideError() {
        errorMessageDiv.style.display = 'none';
        errorTextSpan.textContent = '';
    }
});
