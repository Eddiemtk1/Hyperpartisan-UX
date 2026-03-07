// This listens for messages from your popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    if (request.action === "analyzeArticle") {
        console.log("TruthLens Background: Starting analysis...");

        // 1. Make the API call to your FastAPI backend
        fetch('http://127.0.0.1:8000/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: request.text })
        })
        .then(response => {
            if (!response.ok) throw new Error("API Server Error");
            return response.json();
        })
        .then(data => {
            // 2. Save the result to Chrome's local storage, tied to this specific Tab ID
            // This ensures if the popup closes, the data isn't lost!
            let storageObj = {};
            storageObj[`bias_result_${request.tabId}`] = data;
            
            chrome.storage.local.set(storageObj, () => {
                // 3. Send the data back to the popup (if it is still open)
                sendResponse({ success: true, data: data });
            });
        })
        .catch(error => {
            console.error("TruthLens API Error:", error);
            sendResponse({ success: false, error: error.message });
        });

        // Return true to tell Chrome we will send the response asynchronously (later)
        return true; 
    }
});