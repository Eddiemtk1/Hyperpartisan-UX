// When the popup opens, check if we already scanned this specific tab
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
        const tabId = tabs[0].id;
        const storageKey = `bias_result_${tabId}`;
        
        chrome.storage.local.get([storageKey], (result) => {
            if (result[storageKey]) {
                console.log("TruthLens: Found cached results for this tab!");
                const data = result[storageKey];
                
                // 1. Rebuild the popup UI
                renderResult(data);
                
                // 2. Re-apply the highlights to the actual webpage!
                if (data.is_hyperpartisan && data.biased_items) {
                    const sentencesToHighlight = data.biased_items.map(item => item.sentence);
                    chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        func: highlightSentencesInPage, // Ensure this function is still at the bottom of popup.js
                        args: [sentencesToHighlight]
                    });
                }
            }
        });
    }
});

// UI State Management
const states = {
    IDLE: 'state-idle',
    LOADING: 'state-loading',
    RESULT: 'state-result',
    ERROR: 'state-error'
};

function switchState(targetState) {
    // Hide all states by applying 'hidden' class
    Object.values(states).forEach(stateId => {
        const el = document.getElementById(stateId);
        if (el) {
            if (stateId === targetState) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        }
    });
}

document.getElementById('scanBtn').addEventListener('click', async () => {
    switchState(states.LOADING);

    try {
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Prevent scanning restricted Chrome pages
        if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
            switchState(states.ERROR);
            console.error("Blocked: Cannot scan internal browser pages.");
            return;
        }

        // 1. FIRST, inject the scraper to get the text from the webpage
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: scrapePageText,
        }, (injectionResults) => {
            
            if (chrome.runtime.lastError || !injectionResults || !injectionResults[0]) {
                switchState(states.ERROR);
                console.error("Injection failed.");
                return;
            }

            // 2. DEFINE the scrapedText variable here!
            const scrapedText = injectionResults[0].result;

            // 3. NOW send the message to the background script
            chrome.runtime.sendMessage({
                action: "analyzeArticle",
                text: scrapedText,
                tabId: tab.id
            }, (response) => {
                
                if (chrome.runtime.lastError) {
                    console.error("Communication Error:", chrome.runtime.lastError.message);
                    switchState(states.ERROR);
                    return;
                }

                if (response && response.success) {
                    const data = response.data;
                    renderResult(data);

                    if (data.is_hyperpartisan && data.biased_items) {
                        const sentencesToHighlight = data.biased_items.map(item => item.sentence);
                        chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            func: highlightSentencesInPage,
                            args: [sentencesToHighlight]
                        });
                    }
                } else {
                    console.error("TruthLens Server/API Error:", response?.error);
                    switchState(states.ERROR);
                }
            });
        });

    } catch (error) {
        console.error("Critical Error in listener:", error);
        switchState(states.ERROR);
    }
});

document.getElementById('resetBtn').addEventListener('click', () => {
    switchState(states.IDLE);
    // Reset bar width for next animation
    document.getElementById('confidence-bar').style.width = '0%';
});

document.getElementById('retryBtn').addEventListener('click', () => {
    switchState(states.IDLE);
});

function displayError(title, messageHtml) {
    const errorBox = document.querySelector('.error-box');
    errorBox.querySelector('h4').innerText = title;
    document.getElementById('error-text').innerHTML = messageHtml;
    switchState(states.ERROR);
}

function renderResult(data) {
    const statusCard = document.getElementById('status-card');
    const iconWrapper = document.getElementById('status-icon-wrapper');
    const verdictTitle = document.getElementById('verdict-title');
    const confidenceBar = document.getElementById('confidence-bar');
    const confidenceText = document.getElementById('confidence-text');

    // Reset card classes
    statusCard.className = 'status-card';

    // Force parse as a float and provide a hard 0 fallback
    let confValue = parseFloat(data.overall_confidence || data.confidence || 0);
    let confidencePercentage = (confValue * 100).toFixed(1);

    // Ultimate failsafe
    if (isNaN(confidencePercentage)) {
        confidencePercentage = "0.0";
    }

    if (data.is_hyperpartisan) {
        // Hyperpartisan styling
        statusCard.classList.add('danger');

        // Alert Icon
        iconWrapper.innerHTML = `
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
        `;
        verdictTitle.innerText = "High Bias Detected";

        const container = document.getElementById('biased-items-container');
        container.innerHTML = ''; // Clear previous results

        data.biased_items.forEach((item, index) => {
            const itemHtml = `
                <div style="margin-bottom: 24px;">
                    <div class="quote-box">
                        <svg class="quote-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path>
                            <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"></path>
                        </svg>
                        <p style="margin: 0; font-size: 14px; font-style: italic; line-height: 1.6; color: var(--text-primary);">"${item.sentence}"</p>
                    </div>
                    <div class="explanation-box">
                        <h4 style="margin: 0 0 10px 0; font-size: 13px; color: var(--text-secondary); text-transform: uppercase;">Why is this flagged?</h4>
                        <p style="margin: 0; font-size: 14px; line-height: 1.6; color: var(--text-secondary);">${item.explanation}</p>
                    </div>
                </div>
            `;
            container.innerHTML += itemHtml;
        });

        document.getElementById('biased-content').classList.remove('hidden');
        document.getElementById('neutral-content').classList.add('hidden');

    } else {
        // Neutral styling
        statusCard.classList.add('success');

        // Checkmark Icon
        iconWrapper.innerHTML = `
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
        `;
        verdictTitle.innerText = "Mostly Neutral";

        document.getElementById('biased-content').classList.add('hidden');
        document.getElementById('neutral-content').classList.remove('hidden');
    }

    // Shared confidence bar setup
    confidenceText.innerText = `${confidencePercentage}%`;

    // Switch to result
    switchState(states.RESULT);

    // Trigger animation slightly after the container becomes visible
    setTimeout(() => {
        confidenceBar.style.width = `${data.is_hyperpartisan ? confidencePercentage : Math.max(0, 100 - confidencePercentage)}%`;
    }, 150);
}

// NOTE: This function is serialized and executed in the context of the active tab.
function scrapePageText() {
    const contentNodes = document.querySelectorAll('article p, main p, .story-body p, .article-content p');
    let textArray = [];

    // Words that indicate UI, paywalls, or marketing boilerplate
    const blacklist = ['subscribe', 'create an account', 'newsletter', 'sign up', 'log in', 'free articles'];

    function isValidNode(node) {
        const text = node.innerText.trim();
        const lowerText = text.toLowerCase();

        // 1. Is it trapped in a known non-article wrapper?
        const isJunk = node.closest('nav, header, footer, aside, .sidebar, .comments, .paywall, .ad, form');

        // 2. Does it contain obvious marketing speak?
        const hasBoilerplate = blacklist.some(word => lowerText.includes(word));

        // 3. Is it too short to be a real journalistic sentence?
        const isLongEnough = text.split(/\s+/).length > 8;

        return !isJunk && !hasBoilerplate && isLongEnough;
    }

    if (contentNodes.length > 0) {
        contentNodes.forEach(node => {
            if (isValidNode(node)) textArray.push(node.innerText.trim());
        });
    } else {
        // Fallback
        document.querySelectorAll('p').forEach(node => {
            if (isValidNode(node)) textArray.push(node.innerText.trim());
        });
    }

    return textArray.join(" ");
}

// Injected into the page to highlight multiple biased paragraphs
function highlightSentencesInPage(sentences) {
    if (!sentences || sentences.length === 0) return;

    const elements = document.querySelectorAll('p, h1, h2, h3, h4, li');
    let scrolled = false;

    // Helper: Removes ALL punctuation and squashes spaces for a pure word-to-word comparison
    const cleanText = (str) => str.replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

    elements.forEach(el => {
        const elClean = cleanText(el.innerText);
        if (elClean.length < 15) return; // Skip tiny UI elements

        for (let sentence of sentences) {
            const sentenceClean = cleanText(sentence);

            // Grab the first 35 characters (about 5-7 words) to act as a unique fingerprint
            const fingerprint = sentenceClean.substring(0, 35);

            // If the element's clean text contains our fingerprint, it's a guaranteed match
            if (fingerprint.length > 10 && elClean.includes(fingerprint)) {

                el.style.backgroundColor = 'rgba(252, 165, 165, 0.3)';
                el.style.borderLeft = '4px solid #ef4444';
                el.style.paddingLeft = '10px';
                el.style.borderRadius = '3px';

                if (!scrolled) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    scrolled = true;
                }

                break; // Found a match, move to the next HTML element
            }
        }
    });
}