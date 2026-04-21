When popup opens:
    GET current active tab
    CHECK browser storage for cached results linked to the active tab

    IF cache results exist:
        INJECT script into page and highlight biased sentences


ON CLICK 'analyse article' button:
    CHANGE screen to loading 
    GET current active tab

        IF tab is a resricted page:
            STOP process and show error

        INJECT Readability.js into the tab
        SCRAPE active tab to extract article text

        WAIT for scraped text
        SEND message to background script with scraped text


ON RECIEVE message 'analysearticle':
    SEND POST request to backend API witht the scraped text

    IF request is successful:
        RECIEVE analysis data
        SAVE analysis data to browser storage with tab ID
        INJECT script into tab and hylight the extracted sentences
        SEND analysis data to popup

    ELSE:
        SEND error back to popup


ONCE RECIEVE analysis data from background script:
    CHANGE UI state to 'results'
    UPDATE confidence progress bar

    IF analysis data is hyperpartisan:
        DISPLAY warning box 
    ELSE:
        DISPLAY safe box
