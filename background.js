chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "searchOnMis",
        title: "Search on Mis",
        contexts: ["selection"]
    });
    chrome.contextMenus.create({
        id: "searchOnSiro",
        title: "Search on Siro",
        contexts: ["selection"]
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "searchOnMis") {
        const query = info.selectionText.trim();
        data = query.match(/([a-zA-z]+)(0{1,})?-?([0-9]{3,})/)
        console.log(data)
        // console.log(query);
        const misSearchUrl = `https://missav.ws/search/${encodeURIComponent(data[1] + "-" + data[3])}`;

        // console.log(misSearchUrl);
        chrome.tabs.create({url: misSearchUrl});
    } else if (info.menuItemId === "searchOnSiro") {
        const query = info.selectionText.trim();
        // console.log(query);
        const siroSearchUrl = `https://sirowiki.com/search/?keyword=${encodeURIComponent(query)}`;
        // console.log(siroSearchUrl);
        chrome.tabs.create({url: siroSearchUrl});
    }
});

chrome.commands.onCommand.addListener((command) => {
    if (command === "search_on_mis") {
        console.log(command);
        chrome.tabs.query({currentWindow: true, active: true}, function (result) {
            tab = result[0];
            chrome.scripting.executeScript({
                target: {tabId: tab.id},
                function: () => {
                    return getSelection().toString();
                }
            }).then((res) => {
                const query = res[0].result.trim();
                data = query.match(/([a-zA-z]+)(0{1,})?-?([0-9]{3,})/)
                console.log(data)
                // console.log(query);
                const misSearchUrl = `https://missav.ws/search/${encodeURIComponent(data[1] + "-" + data[3])}`;

                // console.log(misSearchUrl);
                chrome.tabs.create({url: misSearchUrl});
            });
        });
    } else if (command === "search_on_siro") {
        console.log(command);
        chrome.tabs.query({currentWindow: true, active: true}, function (result) {
            tab = result[0];
            chrome.scripting.executeScript({
                target: {tabId: tab.id},
                function: () => {
                    return getSelection().toString();
                }
            }).then((res) => {
                const query = res[0].result.trim();
                // console.log(query);
                const siroSearchUrl = `https://sirowiki.com/search/?keyword=${encodeURIComponent(query)}`;
                // console.log(siroSearchUrl);
                chrome.tabs.create({url: siroSearchUrl});
            });
        });
    }
})