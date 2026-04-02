//When the popup opens, it checks if this tab has been scanned before
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
        const tabId = tabs[0].id;
        const storageKey = `bias_result_${tabId}`;

        chrome.storage.local.get([storageKey], (result) => {
            if (result[storageKey]) {
                console.log("TruthLens: Found cached results for this tab!");
                const data = result[storageKey];

                //Rebuild the popup UI
                renderResult(data);

                //Re-apply the highlights to the webpage
                if (data.is_hyperpartisan && data.biased_items) {
                    const sentencesToHighlight = data.biased_items.map(item => item.sentence);
                    chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        func: highlightSentencesInPage, 
                        args: [sentencesToHighlight]
                    });
                }
            }
        });
    }
});

const states = {
    IDLE: 'state-idle',
    LOADING: 'state-loading',
    RESULTS: 'state-results',
    SETTINGS: 'state-settings',
    ERROR: 'state-error'
};

function switchState(targetState) {
    Object.values(states).forEach(stateId => {
        const el = document.getElementById(stateId);
        if (el) {
            if (stateId === targetState) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
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
            console.error("Blocked: Cannot scan internal browser pages.");
            // Optional: You can create a specific error screen later
            return;
        }

        //Inject mozilla readability library first
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['Readability.js']
        });

        // 1. FIRST, inject the scraper to get the text from the webpage
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: scrapePageText,
        }, (injectionResults) => {

            if (chrome.runtime.lastError || !injectionResults || !injectionResults[0]) {
                console.error("Injection failed.");
                return;
            }

            // 2. DEFINE the scrapedText variable here!
            const scrapedText = injectionResults[0].result;

            // 3. NOW send the message to the background script
            chrome.runtime.sendMessage({
                action: "analyseArticle",
                text: scrapedText,
                tabId: tab.id
            }, (response) => {

                if (chrome.runtime.lastError) {
                    console.error("Communication Error:", chrome.runtime.lastError.message);
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
                }
            });
        });

    } catch (error) {
        console.error("Critical Error in listener:", error);
    }
});

// FIXED: Hooked up to the new "Scan Another Article" button ID
document.getElementById('resetBtn')?.addEventListener('click', () => {
    switchState(states.IDLE);
    document.getElementById('ui-confidence-fill').style.width = '0%';
});

// --- POPULATING THE NEW UI ---
function renderResult(data) {
    switchState(states.RESULTS);

    // 1. Update the Confidence Score Card
    const confidencePct = Math.round(data.overall_confidence * 100);
    document.getElementById('ui-confidence-score').textContent = `${confidencePct}%`;
    
    // Animate the progress bar width
    setTimeout(() => {
        document.getElementById('ui-confidence-fill').style.width = `${confidencePct}%`;
    }, 100); 

    // 2. Update the Alert Box
    const alertBox = document.getElementById('ui-alert-box');
    const alertTitle = document.getElementById('ui-alert-title');
    const alertDesc = document.getElementById('ui-alert-desc');
    const alertIcon = document.getElementById('ui-alert-icon');

    if (data.is_hyperpartisan) {
        // Keep the warning styling defined in the CSS
        alertBox.style.backgroundColor = 'var(--warning-bg)';
        alertBox.style.borderColor = 'var(--warning-border)';
        alertTitle.style.color = 'var(--warning-text)';
        alertDesc.style.color = 'var(--warning-text)';
        alertIcon.style.color = 'var(--warning-icon)';
        alertIcon.textContent = 'warning';
        
        alertTitle.textContent = "Hyperpartisanship Detected";
        alertDesc.textContent = "The AI flagged manipulative or partisan language in this text.";
    } else {
        // Override with Green "Safe" styling
        alertBox.style.backgroundColor = 'rgba(34, 197, 94, 0.1)';
        alertBox.style.borderColor = 'rgba(34, 197, 94, 0.2)';
        alertTitle.style.color = '#15803d';
        alertDesc.style.color = '#15803d';
        alertIcon.style.color = '#16a34a';
        alertIcon.textContent = 'check_circle';
        
        alertTitle.textContent = "Highly Objective";
        alertDesc.textContent = "This article relies on neutral, fact-based reporting.";
    }

    // 3. Inject the Quotes & Categories into the Insights Card
    const container = document.getElementById('biased-items-container');
    container.innerHTML = '';

    if (!data.biased_items || data.biased_items.length === 0) {
        container.innerHTML = '<p class="explanation-text" style="text-align: center;">No significant bias found in this text.</p>';
        return;
    }

    data.biased_items.forEach(item => {
        // Build the new UI element for each quote
        const itemHtml = `
            <div class="insight-item">
                <div style="display: inline-block; padding: 2px 8px; border-radius: 4px; background-color: var(--primary-light); color: var(--primary); font-size: 10px; font-weight: 700; text-transform: uppercase; margin-bottom: 8px;">
                    ${item.bias_type || 'Flagged Insight'}
                </div>
                <p class="quote-text">"${item.sentence}"</p>
                <p class="explanation-text">${item.explanation}</p>
            </div>
        `;
        container.innerHTML += itemHtml;
    });
}

//Scraping
function scrapePageText() {
    try {
        var documentClone = document.cloneNode(true);
        var reader = new Readability(documentClone);
        var article = reader.parse();

        if (article && article.textContent) {
            return article.textContent.replace(/\s+/g, ' ').trim();
        } else {
            throw new Error("Readability could not parse the article.");
        }
    } catch (e) {
        console.error("Readability failed, falling back to basic extraction.", e);
        return document.body.innerText.replace(/\s+/g, ' ').trim();
    }
}

function highlightSentencesInPage(sentences) {
    if (!sentences || sentences.length === 0) return;

    const elements = document.querySelectorAll('p, h1, h2, h3, h4, li');
    let scrolled = false;
    const cleanText = (str) => str.replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

    elements.forEach(el => {
        const elClean = cleanText(el.innerText);
        if (elClean.length < 15) return;

        for (let sentence of sentences) {
            const sentenceClean = cleanText(sentence);
            const fingerprint = sentenceClean.substring(0, 35);

            if (fingerprint.length > 10 && elClean.includes(fingerprint)) {
                el.style.backgroundColor = 'rgba(252, 165, 165, 0.3)';
                el.style.borderLeft = '4px solid #ef4444';
                el.style.paddingLeft = '10px';
                el.style.borderRadius = '3px';
                el.style.transition = 'all 0.5s ease';
                el.setAttribute('data-truthlens', 'true');

                if (!scrolled) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    scrolled = true;
                }
                break; 
            }
        }
    });
}

//HIGHLIGHTS LOGIC
const clearHighlightsLogic = async () => {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: removeHighlightsFromPage
    });
};
document.getElementById('clearHighlightsBtn')?.addEventListener('click', clearHighlightsLogic);
document.getElementById('clearHighlightsBtnIdle')?.addEventListener('click', clearHighlightsLogic);

function removeHighlightsFromPage() {
    const highlightedElements = document.querySelectorAll('[data-truthlens="true"]');
    highlightedElements.forEach(el => {
        el.style.backgroundColor = '';
        el.style.borderLeft = '';
        el.style.paddingLeft = '';
        el.style.borderRadius = '';
        el.removeAttribute('data-truthlens');
    });
}

// --- SETTINGS & THEME LOGIC ---

// 1. Load the saved theme when the popup opens
chrome.storage.local.get(['truthlens_theme'], (result) => {
    const savedTheme = result.truthlens_theme || 'system';
    document.getElementById('themeSelector').value = savedTheme;
    applyTheme(savedTheme);
});

// 2. Function to apply the theme to the HTML tag
function applyTheme(theme) {
    if (theme === 'system') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', theme);
    }
}

// 3. Listen for changes in the dropdown
document.getElementById('themeSelector').addEventListener('change', (e) => {
    const newTheme = e.target.value;
    applyTheme(newTheme);
    chrome.storage.local.set({ truthlens_theme: newTheme }); // Save it forever
});

// 4. Navigation Buttons
document.getElementById('settingsIcon').addEventListener('click', () => {
    switchState(states.SETTINGS);
});

document.getElementById('backBtn').addEventListener('click', () => {
    // Return to the idle screen (or you could get fancy and remember the previous state!)
    switchState(states.IDLE);
});

// 5. Clear Cache Logic
document.getElementById('clearCacheBtn').addEventListener('click', () => {
    const btn = document.getElementById('clearCacheBtn');
    
    // Find all keys in storage, and delete the ones starting with "bias_result_"
    chrome.storage.local.get(null, (items) => {
        const keysToRemove = Object.keys(items).filter(key => key.startsWith('bias_result_'));
        chrome.storage.local.remove(keysToRemove, () => {
            // Visual feedback
            const originalText = btn.textContent;
            btn.textContent = "Cache Cleared!";
            btn.style.backgroundColor = 'rgba(34, 197, 94, 0.1)';
            btn.style.color = '#15803d';
            btn.style.borderColor = '#16a34a';
            
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.backgroundColor = 'transparent';
                btn.style.color = '#ef4444';
                btn.style.borderColor = '#ef4444';
            }, 2000);
        });
    });
});