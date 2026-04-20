chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    if (request.action === "analyseArticle") {
        console.log("TruthLens Background: Starting analysis...");

        //Make the API call to your FastAPI backend
        fetch('http://127.0.0.1:8000/analyse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                title: request.title,
                text: request.text 
            })
        })
        .then(response => {
            if (!response.ok) throw new Error("API Server Error");
            return response.json();
        })
        .then(data => {
            //Saves the result to chrome's cache
            let storageObj = {};
            storageObj[`bias_result_${request.tabId}`] = data;
            
            chrome.storage.local.set(storageObj, () => {
                //send the data back to the popup, if its still open
                try { sendResponse({ success: true, data: data }); } catch (e) {}

                // highlights the page from the background
                if (data.is_hyperpartisan && data.biased_items) {
                    const sentencesToHighlight = data.biased_items.map(item => item.sentence);
                    
                    chrome.scripting.executeScript({
                        target: { tabId: request.tabId },
                        func: highlightSentencesInPage,
                        args: [sentencesToHighlight]
                    }).catch(err => console.error("Highlight injection error:", err));
                }
            });
        })
        .catch(error => {
            console.error("TruthLens API Error:", error);
            try { sendResponse({ success: false, error: error.message }); } catch (e) {}
        });

        return true; 
    }
});

//Highlighting function
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