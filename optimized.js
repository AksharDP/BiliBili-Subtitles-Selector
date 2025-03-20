// ==UserScript==
// @name         BiliBili Subtitles Selector
// @namespace    http://tampermonkey.net/
// @version      2025-03-19
// @description  OpenSubtitles integration for Bilibili videos
// @author       You
// @match        https://www.bilibili.com/bangumi/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=bilibili.com
// @grant        none
// ==/UserScript==

(function() {
    ("use strict");

    // --- Constants ---
    const DB_NAME = "BiliBiliSubtitlesSelector";
    const DB_VERSION = 1;
    const STORE_NAME = "tokens";
    const SUBTITLES_STORE_NAME = "subtitles"; // Store name for subtitles cache
    const SETTINGS_STORE_NAME = "settings"; // Store name for settings
    const VIP_API_ENDPOINT = "https://vip-api.opensubtitles.com/api/v1";
    const PUBLIC_API_ENDPOINT = "https://api.opensubtitles.com/api/v1";
    const API_KEY = "tvtbGAFEHAWjXcQD0QxOAfKIPbRWFGSW";
    const USER_AGENT = "BiliBili Subtitles Selector 1.0";
    const TOKEN_EXPIRY_DAYS = 30;
    const SUBTITLE_CACHE_SIZE = 20;
    const USER_INFO_CACHE_EXPIRY_HOURS = 1;
    let subtitleApplicationInProgress = false;


    // --- Global Variables ---
    let currentSearchResults = [];
    let currentPage = 1;
    let totalPages = 1;
    let totalCount = 0;
    let perPage = 50;
    let currentSearchQuery = "";
    let currentSearchParams = null;

    // --- Settings ---
    let currentFontColor = "#FFFFFF";
    let currentOutlineColor = "#000000";
    let currentBgColor = "#000000";

    // --- Helper Functions ---

    /**
     * Creates a styled button element.
     * @param {string} id - Button ID.
     * @param {string} text - Button text.
     * @param {function} onClick - Click handler function.
     * @param {string} style - Custom CSS style string.
     * @returns {HTMLButtonElement} - The created button element.
     */
    function createButton(id, text, onClick, style = "") {
        const button = document.createElement("button");
        button.id = id;
        button.textContent = text;
        button.type = "button"; // Prevents form submission
        button.style.cssText = `
            padding: 8px 15px;
            background-color: #f0f0f0;
            color: #333;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-family: Arial, sans-serif;
            ${style}
        `;
        if (onClick) {
            button.addEventListener("click", onClick);
        }
        return button;
    }

    /**
     * Creates a styled div element.
     * @param {string} id - Div ID.
     * @param {string} innerHTML - Inner HTML content.
     * @param {string} style - Custom CSS style string.
     * @returns {HTMLDivElement} - The created div element.
     */
    function createDiv(id, innerHTML = "", style = "") {
        const div = document.createElement("div");
        div.id = id;
        div.innerHTML = innerHTML;
        div.style.cssText = style;
        return div;
    }

    // --- Modal Functions ---

    // Create results modal - moved to section below createUI for better flow
    // Create results modal - moved to section below createUI for better flow

    // Show results modal
    function showResultsModal() {
        // Update summary if results exist
        if (currentSearchResults.length > 0) {
            updateResultsSummary();
            displayCurrentPage();
        }
        document.getElementById("opensubtitles-results-overlay").style.display =
            "flex";
        document.getElementById("opensubtitles-search-overlay").style.display =
            "none";
    }

    // Hide results modal
    function hideResultsModal() {
        document.getElementById("opensubtitles-results-overlay").style.display =
            "none";
    }

    // Update results summary in modal header
    function updateResultsSummary() {
        const summaryElement = document.getElementById("os-results-summary");

        // Extract language more safely
        let languageValue = "All";
        if (currentSearchParams?.includes("languages=")) {
            const match = currentSearchParams.match(/languages=([^&]+)/);
            if (match && match[1]) {
                languageValue = match[1];
            }
        }

        summaryElement.innerHTML = `
            <strong>Search:</strong> ${currentSearchQuery || "All"}  
            <strong>Languages:</strong> ${languageValue}  
            <strong>Results:</strong> ${totalCount}
        `;
    }

    // Back to search function
    function backToSearch() {
        hideResultsModal();
        document.getElementById("opensubtitles-search-overlay").style.display =
            "flex";
    }

    // Navigate results pages
    async function navigateResults(direction) {
        if (direction === "prev" && currentPage > 1) {
            currentPage--;
            await fetchResultsPage(currentPage);
        } else if (direction === "next" && currentPage < totalPages) {
            currentPage++;
            await fetchResultsPage(currentPage);
        }
    }

    // Fetch a specific page of search results
    async function fetchResultsPage(page) {
        if (!currentSearchParams) return;

        const statusElement = document.getElementById("os-pagination-info");
        statusElement.textContent = "Loading...";

        try {
            const tokenData = await getToken();
            if (!tokenData || !tokenData.token) {
                statusElement.textContent =
                    "Authentication error. Please log in again.";
                return;
            }

            const apiEndpoint =
                tokenData.base_url === "vip-api.opensubtitles.com"
                    ? VIP_API_ENDPOINT
                    : PUBLIC_API_ENDPOINT;
            const params = new URLSearchParams(currentSearchParams);
            params.set("page", page);

            const response = await fetch(
                `${apiEndpoint}/subtitles?${params.toString()}`,
                {
                    headers: getApiHeaders(tokenData.token),
                }
            );

            const data = await response.json();
            if (response.ok) {
                updatePaginationState(data, page);
                displayCurrentPage();
            } else {
                statusElement.textContent = `Error: ${
                    data.message || "Failed to load results"
                }`;
            }
        } catch (error) {
            console.error("Error fetching results page:", error);
            statusElement.textContent =
                "Error loading results. Please try again.";
        }
    }

    // Update pagination global variables
    function updatePaginationState(data, page) {
        currentPage = data.page || page;
        totalPages = data.total_pages || 1;
        totalCount = data.total_count || 0;
        perPage = data.per_page || 50;
        currentSearchResults = data.data || [];
    }

    // Check if a subtitle is in the IndexedDB cache
    async function isSubtitleInCache(subtitleId) {
        try {
            const db = await openDatabase();
            const store = db
                .transaction([SUBTITLES_STORE_NAME], "readonly")
                .objectStore(SUBTITLES_STORE_NAME);
            const request = store.get(subtitleId);

            return new Promise((resolve) => {
                request.onsuccess = () => resolve(!!request.result);
                request.onerror = () => resolve(false);
            });
        } catch (error) {
            console.error("Error checking subtitle in cache:", error);
            return false;
        }
    }

    // Display current page of search results
    async function displayCurrentPage() {
        const container = document.getElementById("os-results-container");
        const paginationInfo = document.getElementById("os-pagination-info");
        const prevBtn = document.getElementById("os-prev-btn");
        const nextBtn = document.getElementById("os-next-btn");

        container.innerHTML = ""; // Clear results

        // Update pagination buttons state
        prevBtn.disabled = currentPage === 1;
        prevBtn.style.opacity = currentPage === 1 ? "0.5" : "1";
        prevBtn.style.cursor = currentPage === 1 ? "default" : "pointer";
        nextBtn.disabled = currentPage >= totalPages;
        nextBtn.style.opacity = currentPage >= totalPages ? "0.5" : "1";
        nextBtn.style.cursor =
            currentPage >= totalPages ? "default" : "pointer";

        paginationInfo.textContent = `${currentPage} of ${totalPages} (${totalCount} results, ${perPage} per page)`;

        const resultsList = document.createElement("div");
        resultsList.style.cssText = `display: flex; flex-direction: column; gap: 10px; width: 100%;`;

        if (currentSearchResults.length === 0) {
            resultsList.appendChild(
                createDiv(
                    "",
                    '<div style="padding: 20px; text-align: center; color: #666; font-family: Arial, sans-serif;">No results found for your search.</div>'
                )
            );
        } else {
            const cacheStatuses = await Promise.all(
                currentSearchResults.map((result) =>
                    isSubtitleInCache(result.id)
                )
            );

            currentSearchResults.forEach((result, index) => {
                const subtitle = result.attributes;
                const cached = cacheStatuses[index];
                const item = createDiv(
                    "",
                    "",
                    `
                    border: 1px solid #e0e0e0;
                    border-radius: 4px;
                    padding: 10px;
                    background-color: #f9f9f9;
                    font-family: Arial, sans-serif;
                    width: 100%;
                    box-sizing: border-box;
                    ${cached ? "border-left: 4px solid #2ecc71;" : ""}
                `
                );

                const featureTitle =
                    subtitle.feature_details?.title ||
                    subtitle.feature_details?.movie_name ||
                    "Unknown title";
                const year = subtitle.feature_details?.year
                    ? `(${subtitle.feature_details.year})`
                    : "";
                const language = subtitle.language || "Unknown language";
                const release = subtitle.release
                    ? `Release: ${subtitle.release}`
                    : "";

                item.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div style="font-weight: bold; color: #00a1d6; margin-bottom: 5px; word-break: break-word;">${featureTitle} ${year}</div>
                        ${
                            cached
                                ? `<div style="background-color: #2ecc71; color: white; font-size: 11px; padding: 2px 6px; border-radius: 10px; margin-left: 5px;">Cached</div>`
                                : ""
                        }
                    </div>
                    <div style="color: #333;">Language: ${language}</div>
                    ${
                        release
                            ? `<div style="color: #555; font-size: 0.9em; word-break: break-word;">${release}</div>`
                            : ""
                    }
                    <div style="margin-top: 8px; display: flex; gap: 8px;">
                        <button class="os-download-btn" data-subtitle-id="${
                            result.id
                        }" style="padding: 5px 10px; background-color: ${
                    cached ? "#2ecc71" : "#00a1d6"
                }; color: white; border: none; border-radius: 3px; cursor: pointer;">
                            ${cached ? "Select (Cached)" : "Select"}
                        </button>
                        <button class="os-save-file-btn" data-subtitle-id="${
                            result.id
                        }" title="Download subtitle file" style="padding: 5px 8px; background-color: #f0f0f0; color: #333; border: none; border-radius: 3px; cursor: pointer; display: flex; align-items: center;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                        </button>
                    </div>
                `;
                resultsList.appendChild(item);
            });
        }
        container.appendChild(resultsList);
        attachResultButtonListeners();
    }

    // Attach event listeners to result buttons (download and save file)
    function attachResultButtonListeners() {
        document.querySelectorAll(".os-download-btn").forEach((button) => {
            button.addEventListener("click", (e) =>
                handleSubtitleDownload(e.target.dataset.subtitleId)
            );
        });
        document.querySelectorAll(".os-save-file-btn").forEach((button) => {
            button.addEventListener("click", (e) =>
                handleSubtitleSaveToFile(
                    e.target.closest(".os-save-file-btn").dataset.subtitleId
                )
            );
        });
    }

    // Handle saving subtitles to file
    async function handleSubtitleSaveToFile(subtitleId) {
        const result = currentSearchResults.find((r) => r.id === subtitleId);
        if (!result) {
            console.error("Subtitle not found in current results");
            return;
        }

        const button = document.querySelector(
            `.os-save-file-btn[data-subtitle-id="${subtitleId}"]`
        );
        if (button) {
            setDownloadButtonLoading(button);
        }

        try {
            const cachedSubtitle = await getSubtitleFromCache(subtitleId);
            const subtitleData =
                cachedSubtitle || (await fetchSubtitleData(subtitleId, result));
            if (!subtitleData) return;

            downloadSubtitleFile(subtitleData.content, subtitleData.fileName);

            if (button) {
                setDownloadButtonSuccess(button);
            }
        } catch (error) {
            console.error("Error downloading subtitle file:", error);
            alert(`Failed to download subtitle: ${error.message}`);
            resetDownloadButton(button);
        }
    }

    // Function to handle automatic user info fetching
    async function handleAutoUserInfoFetch() {
        try {
            // Check if we have cached user info and when it was last updated
            const cachedUserInfo = await getUserInfoFromDB();
            const currentTime = Date.now();

            // If no info exists or it's older than the expiry time, fetch new info
            if (
                !cachedUserInfo ||
                currentTime - cachedUserInfo.timestamp >
                    USER_INFO_CACHE_EXPIRY_HOURS * 60 * 60 * 1000
            ) {
                console.log(
                    "User info expired or not found, fetching fresh data..."
                );
                const freshUserInfo = await getUserInfo();
                if (freshUserInfo) {
                    console.log(
                        "Successfully fetched and stored fresh user info"
                    );
                } else {
                    console.warn("Failed to fetch fresh user info");
                }
            } else {
                console.log(
                    "Using cached user info",
                    new Date(cachedUserInfo.timestamp).toLocaleString()
                );
            }

            // Load the user info into the UI (either fresh or cached)
            await loadUserInfo();
        } catch (error) {
            console.error("Error during auto user info fetch:", error);
        }
    }

    // Store quota information in IndexedDB
    async function storeQuotaInfo(quotaData) {
        try {
            const db = await openDatabase();
            const store = db
                .transaction([SETTINGS_STORE_NAME], "readwrite")
                .objectStore(SETTINGS_STORE_NAME);
            quotaData.id = "quotaInfo";
            store.put(quotaData);
            console.log("Stored quota info:", quotaData);
        } catch (error) {
            console.error("Error storing quota info:", error);
        }
    }

    // Get quota information from IndexedDB
    async function getQuotaInfoFromDB() {
        try {
            const db = await openDatabase();
            const store = db
                .transaction([SETTINGS_STORE_NAME], "readonly")
                .objectStore(SETTINGS_STORE_NAME);
            const request = store.get("quotaInfo");

            return new Promise((resolve) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null);
            });
        } catch (error) {
            console.error("Error retrieving quota info:", error);
            return null;
        }
    }

    // Format UTC date to local time with AM/PM
    function formatUTCtoLocalTime(utcTimeString) {
        if (!utcTimeString) return "Unknown";

        try {
            const date = new Date(utcTimeString);
            if (isNaN(date.getTime())) return "Invalid date";

            return date.toLocaleString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "numeric",
                hour12: true,
            });
        } catch (error) {
            console.error("Error formatting date:", error);
            return "Error formatting date";
        }
    }

    async function fetchSubtitleData(subtitleId, result) {
        let subtitleContent;
        let fileName;

        const cachedSubtitle = await getSubtitleFromCache(subtitleId);
        if (cachedSubtitle) {
            console.log("Using cached subtitle for download:", subtitleId);
            return cachedSubtitle;
        }

        const tokenData = await getToken();
        if (!tokenData || !tokenData.token) {
            alert("Authentication error. Please log in again.");
            return null;
        }

        const apiEndpoint =
            tokenData.base_url === "vip-api.opensubtitles.com"
                ? VIP_API_ENDPOINT
                : PUBLIC_API_ENDPOINT;
        const fileId =
            result.attributes.files?.[0]?.file_id || result.attributes.file_id;
        if (!fileId)
            throw new Error("Could not find file_id in subtitle information");

        const response = await fetch(`${apiEndpoint}/download`, {
            method: "POST",
            headers: getApiHeaders(tokenData.token, tokenData.apiKey),
            body: JSON.stringify({ file_id: fileId }),
        });

        const data = await response.json();
        if (!response.ok)
            throw new Error(data.message || "Failed to get download link");

        // Store quota information from download response
        if (
            data.requests !== undefined &&
            data.remaining !== undefined &&
            data.reset_time_utc
        ) {
            await storeQuotaInfo({
                requests: data.requests,
                remaining: data.remaining,
                reset_time: data.reset_time,
                reset_time_utc: data.reset_time_utc,
                timestamp: Date.now(),
            });

            // Refresh user info in settings UI if it's visible
            if (
                document.getElementById("opensubtitles-settings-overlay").style
                    .display === "flex"
            ) {
                await loadUserInfo();
            }
        }

        // Direct download attempt
        try {
            console.log("Attempting direct download from:", data.link);

            // We use fetch directly on the link - without any proxy
            const subtitleResponse = await fetch(data.link, {
                method: "GET",
                // Intentionally not setting mode to allow browser to use default behavior
            });

            if (!subtitleResponse.ok) {
                throw new Error(
                    `Failed to download subtitle file (${subtitleResponse.status})`
                );
            }

            subtitleContent = await subtitleResponse.text();
            fileName = data.file_name || `subtitle_${subtitleId}.srt`;

            // Success! Store subtitle and return
            await storeSubtitle({
                id: subtitleId,
                content: subtitleContent,
                fileName: fileName,
                language: result.attributes.language,
                title: result.attributes.feature_details?.title || "Unknown",
                timestamp: Date.now(),
            });

            console.log(
                `OpenSubtitles download quota: ${data.remaining}/${data.requests} (Resets: ${data.reset_time})`
            );
            return { content: subtitleContent, fileName: fileName };
        } catch (error) {
            console.error("Direct download failed:", error);

            // Since direct download failed, we'll provide a clear error message with instructions
            throw new Error(
                "Download failed: Unable to download subtitle file directly. " +
                    "This may be due to CORS restrictions. Please try downloading " +
                    "the subtitle file manually from OpenSubtitles and then upload it."
            );
        }
    }

    // Download subtitle file to user's computer
    function downloadSubtitleFile(content, fileName) {
        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const downloadLink = document.createElement("a");
        downloadLink.href = url;
        downloadLink.download = fileName;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        setTimeout(() => URL.revokeObjectURL(url), 100);
    }

    // Set download button to loading state
    function setDownloadButtonLoading(button) {
        button.disabled = true;
        button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
                <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
                <path d="M12 2a10 10 0 0 1 10 10"></path>
            </svg>
        `;
        if (!document.getElementById("spin-animation-style")) {
            // Prevent adding style every time
            const style = document.createElement("style");
            style.id = "spin-animation-style";
            style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
            document.head.appendChild(style);
        }
    }

    // Set download button to success state
    function setDownloadButtonSuccess(button) {
        button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2ecc71" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        `;
        setTimeout(() => resetDownloadButton(button), 1500);
    }

    // Reset download button to default state
    function resetDownloadButton(button) {
        if (button) {
            button.disabled = false;
            button.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
            `;
        }
    }

    // Update the loadUserInfo function to include quota information
    async function loadUserInfo() {
        try {
            // Get user account info
            let userData = await getUserInfoFromDB();
            if (
                !userData ||
                Date.now() - userData.timestamp >
                    USER_INFO_CACHE_EXPIRY_HOURS * 60 * 60 * 1000
            ) {
                userData = await getUserInfo();
                if (!userData) {
                    updateUserInfoUIForError(
                        "Unable to load user information.<br>Please check your API token or try again later."
                    );
                    return;
                }
            }

            // Get quota info if available
            const quotaInfo = await getQuotaInfoFromDB();

            // Update UI with combined data
            updateUserInfoUI(userData, quotaInfo);
        } catch (error) {
            console.error("Error loading user info into UI:", error);
            updateUserInfoUIForError(
                "Error loading user information.<br>Please try refreshing."
            );
        }
    }

    // Update user info UI elements with data including quota information
    function updateUserInfoUI(userData, quotaInfo = null) {
        // Modified account information section layout to be more compact
        const userInfoElement = document.getElementById("os-user-info");
        if (userInfoElement) {
            userInfoElement.innerHTML = `
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 10px; font-family: Arial, sans-serif; font-size: 14px;">
                <div><strong>Status:</strong></div>
                <div>
                    ${userData.level || "Unknown"} 
                    ${
                        userData.vip
                            ? '<span id="os-user-vip-badge" style="background-color: #ffc107; color: #000; font-size: 11px; padding: 2px 6px; border-radius: 10px; margin-left: 5px;">VIP</span>'
                            : ""
                    }
                </div>
                
                <div><strong>Downloads:</strong></div>
                <div>${userData.downloads_count || "0"} / ${
                userData.allowed_downloads || "0"
            } (${userData.remaining_downloads || "0"} remaining)</div>
                
                <div><strong>Reset Time:</strong></div>
                <div>${
                    quotaInfo && quotaInfo.reset_time_utc
                        ? formatUTCtoLocalTime(quotaInfo.reset_time_utc)
                        : "Unknown. Download to show."
                }</div>
                
                <div><strong>Last Update:</strong></div>
                <div>${new Date(userData.timestamp).toLocaleString()}</div>
            </div>
        `;
        }
    }

    // Update user info UI for error state
    function updateUserInfoUIForError(message) {
        const userInfoElement = document.getElementById("os-user-info");
        if (userInfoElement) {
            userInfoElement.innerHTML = `<div style="color: #e74c3c; font-family: Arial, sans-serif; font-size: 14px; text-align: center;">${message}</div>`;
        }
    }

    // Helper function to set text content of an element
    function setTextContent(elementId, text) {
        const element = document.getElementById(elementId);
        if (element) element.textContent = text;
    }

    // Helper function to set display style of an element
    function setDisplay(elementId, displayStyle) {
        const element = document.getElementById(elementId);
        if (element) element.style.display = displayStyle;
    }

    // Refresh user info from API
    async function refreshUserInfo() {
        const refreshBtn = document.getElementById("os-refresh-user-info");
        setButtonState(refreshBtn, "Refreshing...", true);

        try {
            const userData = await getUserInfo();
            if (userData) {
                await loadUserInfo();
                setButtonState(
                    refreshBtn,
                    "Updated!",
                    false,
                    "#e8f5e9",
                    "#2e7d32",
                    "#c8e6c9"
                );
            } else {
                setButtonState(
                    refreshBtn,
                    "Failed to Update",
                    false,
                    "#ffebee",
                    "#c62828",
                    "#ef9a9a"
                );
            }
        } catch (error) {
            console.error("Error refreshing user info:", error);
            setButtonState(
                refreshBtn,
                "Error",
                false,
                "#ffebee",
                "#c62828",
                "#ef9a9a"
            );
        } finally {
            setTimeout(() => resetRefreshButton(refreshBtn), 2000);
        }
    }

    // Helper function to set button state (text, disabled, colors)
    function setButtonState(
        button,
        text,
        disabled,
        bgColor,
        color,
        borderColor
    ) {
        if (button) {
            button.textContent = text;
            button.disabled = disabled;
            if (bgColor) button.style.backgroundColor = bgColor;
            if (color) button.style.color = color;
            if (borderColor) button.style.borderColor = borderColor;
        }
    }

    // Reset refresh user info button to default state
    function resetRefreshButton(button) {
        setButtonState(
            button,
            "Refresh Information",
            false,
            "#f0f0f0",
            "#666",
            "#ddd"
        );
    }

    // Create settings modal - moved to section below createUI for better flow

    // Show settings modal
    async function showSettingsModal() {
        const settings = await loadSettingsFromIndexedDB();
        applyLoadedSettingsToUI(settings);
        document.getElementById(
            "opensubtitles-settings-overlay"
        ).style.display = "flex";
    }

    // Hide settings modal
    function hideSettingsModal() {
        document.getElementById(
            "opensubtitles-settings-overlay"
        ).style.display = "none";
    }

    // Save settings to IndexedDB
    async function saveSettingsToIndexedDB(settings) {
        try {
            const db = await openDatabase();
            const transaction = db.transaction([SETTINGS_STORE_NAME], "readwrite");
            const store = transaction.objectStore(SETTINGS_STORE_NAME);
            settings.id = "userSettings";
            store.put(settings);
            return new Promise((resolve) => {
                transaction.oncomplete = resolve; // Now transaction is properly defined
            });
        } catch (error) {
            console.error("Error saving settings to IndexedDB:", error);
            throw error;
        }
    }

    // Load settings from IndexedDB
    async function loadSettingsFromIndexedDB() {
        try {
            const db = await openDatabase();
            const store = db
                .transaction([SETTINGS_STORE_NAME], "readonly")
                .objectStore(SETTINGS_STORE_NAME);
            const request = store.get("userSettings");

            return new Promise((resolve, reject) => {
                request.onsuccess = () =>
                    resolve(request.result || getDefaultSettings());
                request.onerror = () => reject(getDefaultSettings());
            });
        } catch (error) {
            console.error("Error loading settings from IndexedDB:", error);
            return getDefaultSettings();
        }
    }

    // Get default settings
    function getDefaultSettings() {
        return {
            fontSize: 16,
            fontColor: "#FFFFFF",
            bgEnabled: true,
            bgColor: "#000000",
            bgOpacity: 0.5,
            outlineEnabled: false,
            outlineColor: "#000000",
            syncOffset: 0,
            animationEnabled: true
        };
    }

    // Load settings and update UI
    async function loadSettings() {
        try {
            const settings = await loadSettingsFromIndexedDB();
            applyLoadedSettingsToUI(settings);
        } catch (error) {
            console.error("Error in loadSettings:", error);
            applyLoadedSettingsToUI(getDefaultSettings()); // Fallback to defaults
        }
    }

    // Apply loaded settings to settings modal UI
    function applyLoadedSettingsToUI(settings) {
        currentFontColor = settings.fontColor;
        currentOutlineColor = settings.outlineColor || "#000000";
        currentBgColor = settings.bgColor || "#000000";
    
        setTextContent("os-font-size-value", `${settings.fontSize}px`);
        setInputVal("os-bg-opacity", settings.bgOpacity);
        setTextContent("os-bg-opacity-value", settings.bgOpacity);
        setInputVal("os-sync-slider", settings.syncOffset);
        setInputVal("os-sync-value", settings.syncOffset);
        setCheckboxState("os-animation-toggle", settings.animationEnabled !== false);

        
        // First set the toggle state
        const bgEnabled = settings.bgEnabled === true;
        setCheckboxState("os-bg-toggle", bgEnabled);
        
        // Apply visibility before setting other bg-related values
        updateBgOptionsVisibility(bgEnabled);
        
        setInputVal("os-custom-bg-color", settings.bgColor || "#000000");
        setInputVal("os-bg-hex-color-input", settings.bgColor || "#000000");
        setCheckboxState("os-outline-toggle", settings.outlineEnabled === true);
        setInputVal(
            "os-custom-outline-color",
            settings.outlineColor || "#000000"
        );
        setInputVal(
            "os-outline-hex-color-input",
            settings.outlineColor || "#000000"
        );
        setInputVal("os-hex-color-input", settings.fontColor);
    
        // Set animation type and duration
        setSelectOption("os-animation-type", settings.animationType || "fade");
        setInputVal("os-animation-duration", settings.animationDuration || 0.3);
        setTextContent("os-animation-duration-value", `${settings.animationDuration || 0.3}s`);
    
        highlightSelectedFontColor(settings.fontColor);
        highlightSelectedBgColor(settings.bgColor || "#000000");
        if (settings.outlineEnabled)
            highlightSelectedOutlineColor(settings.outlineColor);
    
        updateBgOptionsVisibility(bgEnabled);
        updateOutlineOptionsVisibility(settings.outlineEnabled === true);
    }

    function setSelectOption(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) element.value = value;
    }

    // Helper function to set input value
    function setInputVal(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) element.value = value;
    }

    // Helper function to set checkbox checked state
    function setCheckboxState(elementId, checked) {
        const element = document.getElementById(elementId);
        if (element) {
            element.checked = checked;
            element.nextElementSibling.style.backgroundColor = checked
                ? "#00a1d6"
                : "#ccc"; // Update toggle UI
            element.nextElementSibling.querySelector("span").style.transform =
                checked ? "translateX(20px)" : ""; // Update toggle UI
        }
    }

    // Save settings from modal UI
    async function saveSettings() {
        const settings = getSettingsFromUI();
        try {
            await saveSettingsToIndexedDB(settings);
            
            // Apply settings to any active subtitles immediately
            applySettingsToActiveSubtitles(settings);
            
            // Close modal immediately
            hideSettingsModal();
            
            // Still show the notification
            showSettingsSavedNotification();
        } catch (error) {
            console.error("Error saving settings:", error);
            showSettingsSavedNotification(true);
        }
    }

    function applySettingsToActiveSubtitles(settings) {
        // Find all subtitle elements using class selectors (more reliable than IDs)
        const allSubtitleOverlays = document.querySelectorAll(".bilibili-subtitles-overlay");
        
        if (allSubtitleOverlays.length === 0) {
            console.log("No active subtitles found to update");
            return;
        }
        
        // Update animation styles
        const styleElement = document.getElementById("subtitle-animation-styles");
        if (styleElement) {
            styleElement.textContent = styleElement.textContent.replace(
                /animation:.*?(\d+\.?\d*)s/g, 
                `animation: $1 ${settings.animationDuration}s`
            );
        }
        
        // Update each subtitle overlay found
        allSubtitleOverlays.forEach(overlay => {
            // Find the draggable container within this overlay
            const subtitleElement = overlay.querySelector("[id^='bilibili-subtitles-draggable-']");
            // Find the text element within the container
            const subtitleTextElement = overlay.querySelector("[id^='bilibili-subtitles-text-']");
            
            if (subtitleElement && subtitleTextElement) {
                // Apply font settings
                subtitleTextElement.style.fontSize = `${Math.max(1, settings.fontSize)}px`;
                subtitleTextElement.style.color = settings.fontColor;
                subtitleTextElement.style.lineHeight = "1.2";
                
                // Apply background settings
                if (settings.bgEnabled) {
                    const [r, g, b] = hexToRgb(settings.bgColor || "#000000");
                    subtitleElement.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${settings.bgOpacity})`;
                    subtitleElement.style.padding = "5px 10px";
                } else {
                    subtitleElement.style.backgroundColor = "transparent";
                    subtitleElement.style.padding = "0";
                }
                
                // Apply outline settings
                if (settings.outlineEnabled) {
                    subtitleTextElement.style.textShadow = `-1px -1px 0 ${settings.outlineColor}, 1px -1px 0 ${settings.outlineColor}, -1px 1px 0 ${settings.outlineColor}, 1px 1px 0 ${settings.outlineColor}`;
                } else {
                    subtitleTextElement.style.textShadow = "none";
                }
                
                // Update sync offset globally
                window.subtitleSyncOffset = settings.syncOffset || 0;
                
                // Remove animation classes to reset
                subtitleTextElement.classList.remove(
                    "subtitle-animation-fade",
                    "subtitle-animation-slideUp",
                    "subtitle-animation-slideDown",
                    "subtitle-animation-zoom"
                );
            }
        });
        
        console.log(`Applied new settings to ${allSubtitleOverlays.length} active subtitle elements`);
    }

    // Get settings object from settings modal UI
    function getSettingsFromUI() {
        return {
            fontSize: parseInt(getTextContent("os-font-size-value")),
            fontColor: currentFontColor || "#FFFFFF",
            bgEnabled: getCheckboxState("os-bg-toggle"),
            bgColor: currentBgColor || "#000000",
            bgOpacity: parseFloat(getInputVal("os-bg-opacity")),
            outlineEnabled: getCheckboxState("os-outline-toggle"),
            outlineColor: currentOutlineColor || "#000000",
            syncOffset: parseFloat(getInputVal("os-sync-value")),
            animationEnabled: getCheckboxState("os-animation-toggle")
        };
    }

    // Helper function to get text content of an element
    function getTextContent(elementId) {
        return document.getElementById(elementId)?.textContent || "";
    }

    // Helper function to get input value
    function getInputVal(elementId) {
        return document.getElementById(elementId)?.value || "";
    }

    // Helper function to get checkbox checked state
    function getCheckboxState(elementId) {
        return document.getElementById(elementId)?.checked || false;
    }

    // Show settings saved notification popup
    function showSettingsSavedNotification(isError = false) {
        const notification = document.getElementById(
            "os-settings-notification"
        );
        notification.style.backgroundColor = isError ? "#e74c3c" : "#2ecc71";
        notification.textContent = isError
            ? "Settings saved with errors"
            : "Settings saved successfully!";
        notification.style.opacity = "1";
        notification.style.transform = "translateY(0)";
        setTimeout(() => {
            notification.style.opacity = "0";
            notification.style.transform = "translateY(-20px)";
        }, 3000);
    }

    // Convert hex color to RGB array
    function hexToRgb(hex) {
        const cleanHex = hex.charAt(0) === "#" ? hex.substring(1, 7) : hex;
        const r = parseInt(cleanHex.substring(0, 2), 16);
        const g = parseInt(cleanHex.substring(2, 4), 16);
        const b = parseInt(cleanHex.substring(4, 6), 16);
        return [r, g, b];
    }

    // Adjust font size in settings
    function adjustFontSize(change) {
        const fontSizeElement = document.getElementById("os-font-size-value");
        let currentSize = parseInt(fontSizeElement.textContent);
        currentSize += change;
        currentSize = Math.max(1, Math.min(currentSize, 36)); // Use 1px as minimum
        fontSizeElement.textContent = `${currentSize}px`;
    }

    // Set background color and highlight in settings
    function setBgColor(color) {
        currentBgColor = color;
    }

    // Highlight selected background color button
    function highlightSelectedBgColor(selectedColor) {
        clearBgColorSelection();
        const colorBtns = document.querySelectorAll(".os-bg-color-btn");
        colorBtns.forEach((btn) => {
            if (
                btn.dataset.color.toUpperCase() === selectedColor.toUpperCase()
            ) {
                btn.style.border = "2px solid #00a1d6";
            }
        });
        if (
            !Array.from(colorBtns).some(
                (btn) =>
                    btn.dataset.color.toUpperCase() ===
                    selectedColor.toUpperCase()
            )
        ) {
            document.getElementById("os-bg-color-container").style.border =
                "2px solid #00a1d6";
        }
    }

    // Clear background color button selection
    function clearBgColorSelection() {
        document.querySelectorAll(".os-bg-color-btn").forEach((btn) => {
            btn.style.border = "1px solid #ddd";
        });
        document.getElementById("os-bg-color-container").style.border =
            "1px solid #ddd";
    }

    // Set outline color and highlight in settings
    function setOutlineColor(color) {
        currentOutlineColor = color;
    }

    // Highlight selected outline color button
    function highlightSelectedOutlineColor(selectedColor) {
        clearOutlineColorSelection();
        const colorBtns = document.querySelectorAll(".os-outline-color-btn");
        colorBtns.forEach((btn) => {
            if (
                btn.dataset.color.toUpperCase() === selectedColor.toUpperCase()
            ) {
                btn.style.border = "2px solid #00a1d6";
            }
        });
        if (
            !Array.from(colorBtns).some(
                (btn) =>
                    btn.dataset.color.toUpperCase() ===
                    selectedColor.toUpperCase()
            )
        ) {
            document.getElementById("os-outline-color-container").style.border =
                "2px solid #00a1d6";
        }
    }

    // Clear outline color button selection
    function clearOutlineColorSelection() {
        document.querySelectorAll(".os-outline-color-btn").forEach((btn) => {
            btn.style.border = "1px solid #ddd";
        });
        document.getElementById("os-outline-color-container").style.border =
            "1px solid #ddd";
    }

    // Set font color and highlight in settings
    function setFontColor(color) {
        currentFontColor = color;
    }

    // Highlight selected font color button
    function highlightSelectedFontColor(selectedColor) {
        clearFontColorSelection();
        const colorBtns = document.querySelectorAll(".os-font-color-btn");
        colorBtns.forEach((btn) => {
            if (
                btn.dataset.color.toUpperCase() === selectedColor.toUpperCase()
            ) {
                btn.style.border = "2px solid #00a1d6";
            }
        });
        if (
            !Array.from(colorBtns).some(
                (btn) =>
                    btn.dataset.color.toUpperCase() ===
                    selectedColor.toUpperCase()
            )
        ) {
            document.getElementById("os-custom-color-container").style.border =
                "2px solid #00a1d6";
        }
    }

    // Clear font color button selection
    function clearFontColorSelection() {
        document.querySelectorAll(".os-font-color-btn").forEach((btn) => {
            btn.style.border = "1px solid #ddd";
        });
        document.getElementById("os-custom-color-container").style.border =
            "1px solid #ddd";
    }


    // Handle button click to show search or login modal
    function handleButtonClick() {
        getToken()
            .then((tokenData) => {
                if (tokenData?.token) {
                    if (
                        currentSearchResults.length > 0 &&
                        currentSearchParams
                    ) {
                        showResultsModal(); // Show results if available
                    } else {
                        showSearchModal(); // Otherwise show search form
                    }
                } else {
                    showLoginModal(); // Show login modal if not logged in
                }
            })
            .catch((error) => {
                console.error("Error checking token:", error);
                showLoginModal(); // Default to login modal on error
            });
    }

    // Create UI elements (button, login modal, search modal)
    function createUI() {
        try {
            console.log("[Subtitles Selector] Creating OpenSubtitles UI elements...");
            // Import Nunito and Inter fonts from Google Fonts
            const fontLink = document.createElement('link');
            fontLink.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap';
            fontLink.rel = 'stylesheet';
            document.head.appendChild(fontLink);

            // Add a global style for all our UI elements
            const globalStyle = document.createElement('style');
            globalStyle.textContent = `
                #opensubtitles-login-btn,
                #opensubtitles-login-overlay *,
                #opensubtitles-search-overlay *,
                #opensubtitles-results-overlay *,
                #opensubtitles-settings-overlay *,
                #os-settings-notification,
                #bilibili-subtitles-draggable * {
                    font-family: 'Nunito', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif !important;
                    font-size: max(1px, var(--subtitle-font-size, 16px)); /* Add minimum font size constraint */
                }
            `;
            document.head.appendChild(globalStyle);

            const button = createButton(
                "opensubtitles-login-btn",
                "OpenSubtitles Login",
                handleButtonClick,
                `
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 9999;
                padding: 10px 15px;
                background-color: #00a1d6;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-family: 'Nunito', 'Inter', sans-serif;
                font-size: 14px;
                box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
            `
            );

            const loginOverlay = createDiv(
                "opensubtitles-login-overlay",
                "",
                `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                z-index: 10000;
                display: none;
                justify-content: center;
                align-items: center;
            `
            );

            const loginModal = createDiv(
                "opensubtitles-login-modal",
                "",
                `
                background-color: white;
                padding: 20px;
                border-radius: 6px;
                box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
                width: 300px;
                max-width: 90%;
            `
            );

            loginModal.innerHTML = `
                <h2 style="margin-top: 0; color: #00a1d6; font-family: Arial, sans-serif;">OpenSubtitles Login</h2>
                <form id="opensubtitles-login-form">
                    <div style="margin-bottom: 15px;">
                        <label for="token" style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif;">API Token:</label>
                        <input type="text" id="os-token" name="token" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;" required>
                        <p style="font-size: 12px; color: #666; margin-top: 5px;">You can find your API token in your <a href="https://www.opensubtitles.com/en/users/profile" target="_blank">OpenSubtitles account settings</a>.</p>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <button type="submit" style="padding: 8px 15px; background-color: #00a1d6; color: white; border: none; border-radius: 4px; cursor: pointer; font-family: Arial, sans-serif;">Login</button>
                        <button type="button" id="os-cancel-btn" style="padding: 8px 15px; background-color: #f0f0f0; color: #333; border: none; border-radius: 4px; cursor: pointer; font-family: Arial, sans-serif;">Cancel</button>
                    </div>
                    <div id="os-login-status" style="margin-top: 15px; color: #e74c3c; display: none;"></div>
                </form>
            `;

            loginOverlay.appendChild(loginModal);

            const searchOverlay = createDiv(
                "opensubtitles-search-overlay",
                "",
                `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                z-index: 10000;
                display: none;
                justify-content: center;
                align-items: center;
            `
            );

            const searchModal = createDiv(
                "opensubtitles-search-modal",
                "",
                `
                background-color: white;
                padding: 0;
                border-radius: 6px;
                box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
                width: 500px;
                max-width: 90%;
                max-height: 80vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            `
            );
            console.log("[Subtitles Selector] searchModal innerhtml");
            searchModal.innerHTML = `
                <div id="os-search-header" style="padding: 20px 20px 0 20px; display: flex; justify-content: space-between; align-items: center;">
                    <h2 style="margin-top: 0; color: #00a1d6; font-family: Arial, sans-serif;">Search Subtitles</h2>
                    <button id="os-settings-btn" style="background: none; border: none; cursor: pointer; padding: 5px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00a1d6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="3"></circle>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                </button>
                </div>
                <div id="os-search-form-container" style="flex: 1; overflow-y: auto; padding: 0 20px;">
                    <form id="opensubtitles-search-form">
                        <div style="margin-bottom: 15px;">
                            <label for="query" style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif;">Search Term:</label>
                            <input type="text" id="os-query" name="query" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;" placeholder="Movie title, filename, or IMDB ID" required>
                        </div>

                        <!-- Moved Season and Episode up, below the search term -->
                        <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                            <div style="flex: 1;">
                                <label for="season_number" style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif;">Season:</label>
                                <input type="number" id="os-season" name="season_number" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;" placeholder="For TV shows">
                            </div>
                            <div style="flex: 1;">
                                <label for="episode_number" style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif;">Episode:</label>
                                <input type="number" id="os-episode" name="episode_number" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;" placeholder="For TV shows">
                            </div>
                        </div>

                        <details style="margin-bottom: 15px;">
                            <summary style="cursor: pointer; color: #00a1d6; font-family: Arial, sans-serif; padding: 5px 0;">Advanced Options</summary>
                            <div style="margin-top: 15px;">
                                <div>
                                    <label for="languages" style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif; font-size: 14px;">Languages:</label>
                                    <div class="language-selector-container" style="position: relative;">
                                        <input type="text" id="os-languages-search" placeholder="Search languages..." style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 5px;">
                                        <div id="os-languages-dropdown" style="display: none; position: absolute; width: 100%; max-height: 200px; overflow-y: auto; background-color: white; border: 1px solid #ddd; border-radius: 4px; z-index: 1000; box-shadow: 0 2px 5px rgba(0,0,0,0.2);"></div>
                                        <div id="os-selected-languages" style="display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px;"></div>
                                        <input type="hidden" id="os-languages" name="languages" value="en">
                                    </div>
                                </div>

                                <div style="margin-bottom: 15px;">
                                    <label for="year" style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif; font-size: 14px;">Year:</label>
                                    <input type="number" id="os-year" name="year" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;" placeholder="4-digit year (e.g. 2024)">
                                </div>

                                <div style="margin-bottom: 15px;">
                                    <label for="type" style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif; font-size: 14px;">Content Type:</label>
                                    <select id="os-type" name="type" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;">
                                        <option value="">All</option>
                                        <option value="movie">Movie</option>
                                        <option value="episode">TV Episode</option>
                                    </select>
                                </div>

                                <div style="margin-bottom: 15px;">
                                    <label for="imdb_id" style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif; font-size: 14px;">IMDB ID:</label>
                                    <input type="text" id="os-imdb-id" name="imdb_id" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;" placeholder="Format: tt1234567">
                                </div>

                                <div style="margin-bottom: 15px;">
                                    <label for="tmdb_id" style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif; font-size: 14px;">TMDB ID:</label>
                                    <input type="text" id="os-tmdb-id" name="tmdb_id" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;" placeholder="Numbers only (e.g. 550)">
                                </div>

                                <div style="margin-bottom: 15px;">
                                    <label for="moviehash" style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif; font-size: 14px;">Movie Hash:</label>
                                    <input type="text" id="os-moviehash" name="moviehash" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;" placeholder="16 character hash">
                                    <div style="display: flex; gap: 10px; margin-top: 5px;">
                                        <label style="display: flex; align-items: center; font-family: Arial, sans-serif; font-size: 14px;">
                                            <input type="radio" name="moviehash_match" value="include" checked> Include
                                        </label>
                                        <label style="display: flex; align-items: center; font-family: Arial, sans-serif; font-size: 14px;">
                                            <input type="radio" name="moviehash_match" value="only"> Only
                                        </label>
                                    </div>
                                </div>

                                <div style="margin-bottom: 15px;">
                                    <label style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif; font-size: 14px;">Translation Type:</label>
                                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                                        <div>
                                            <label style="font-family: Arial, sans-serif; font-size: 14px; margin-bottom: 5px; display: block;">AI Translated:</label>
                                            <select id="os-ai-translated" name="ai_translated" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;">
                                                <option value="include">Include</option>
                                                <option value="exclude">Exclude</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label style="font-family: Arial, sans-serif; font-size: 14px; margin-bottom: 5px; display: block;">Machine Translated:</label>
                                            <select id="os-machine-translated" name="machine_translated" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;">
                                                <option value="exclude">Exclude</option>
                                                <option value="include">Include</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                <div style="margin-bottom: 15px;">
                                    <label for="hearing_impaired" style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif; font-size: 14px;">Hearing Impaired:</label>
                                    <select id="os-hearing-impaired" name="hearing_impaired" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;">
                                        <option value="include">Include</option>
                                        <option value="exclude">Exclude</option>
                                        <option value="only">Only</option>
                                    </select>
                                </div>

                                <div style="margin-bottom: 15px;">
                                    <label for="foreign_parts_only" style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif; font-size: 14px;">Foreign Parts:</label>
                                    <select id="os-foreign-parts" name="foreign_parts_only" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;">
                                        <option value="include">Include</option>
                                        <option value="exclude">Exclude</option>
                                        <option value="only">Only</option>
                                    </select>
                                </div>

                                <div style="margin-bottom: 15px;">
                                    <label for="trusted_sources" style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif; font-size: 14px;">Trusted Sources:</label>
                                    <select id="os-trusted-sources" name="trusted_sources" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;">
                                        <option value="include">Include</option>
                                        <option value="only">Only</option>
                                    </select>
                                </div>

                                <div style="margin-bottom: 15px;">
                                    <label style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif; font-size: 14px;">Sort Results:</label>
                                    <div style="display: flex; gap: 10px;">
                                        <select id="os-order-by" name="order_by" style="flex: 2; padding: 8px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;">
                                            <option value="">Default</option>
                                            <option value="language">Language</option>
                                            <option value="download_count">Downloads</option>
                                            <option value="upload_date">Upload Date</option>
                                            <option value="rating">Rating</option>
                                        </select>
                                        <select id="os-order-direction" name="order_direction" style="flex: 1; padding: 8px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;">
                                            <option value="desc">Desc</option>
                                            <option value="asc">Asc</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </details>
                    </form>
                </div>
                <div id="os-search-buttons" style="padding: 15px 20px; border-top: 1px solid #eee; background-color: white;">
                    <div style="display: flex; justify-content: space-between;">
                        <button type="button" id="os-search-submit-btn" style="padding: 8px 15px; background-color: #00a1d6; color: white; border: none; border-radius: 4px; cursor: pointer; font-family: Arial, sans-serif;">Search</button>
                        <button type="button" id="os-search-cancel-btn" style="padding: 8px 15px; background-color: #f0f0f0; color: #333; border: none; border-radius: 4px; cursor: pointer; font-family: Arial, sans-serif;">Close</button>
                    </div>
                    <div id="os-search-status" style="margin: 15px 0 0; color: #3498db; display: none; text-align: center; font-family: Arial, sans-serif;"></div>
                </div>
                <div id="os-search-results-container" style="flex: 1; overflow-y: auto; overflow-x: hidden; padding: 0 20px 10px 20px; display: none;"></div>
            `;

            searchOverlay.appendChild(searchModal);

            // Create results modal
            const resultsOverlay = createDiv(
                "opensubtitles-results-overlay",
                "",
                `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                z-index: 10000;
                display: none;
                justify-content: center;
                align-items: center;
            `
            );

            const resultsModal = createDiv(
                "opensubtitles-results-modal",
                "",
                `
                background-color: white;
                padding: 0;
                border-radius: 6px;
                box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
                width: 500px;
                max-width: 90%;
                max-height: 80vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            `
            );

            resultsModal.innerHTML = `
                <div id="os-results-header" style="padding: 15px 20px; border-bottom: 1px solid #eee; background-color: #f9f9f9;">
                    <h2 id="os-results-title" style="margin: 0; color: #00a1d6; font-family: Arial, sans-serif; font-size: 18px;">Search Results</h2>
                    <div id="os-results-summary" style="margin-top: 5px; font-size: 14px; color: #666; font-family: Arial, sans-serif;"></div>
                </div>
                <div id="os-results-container" style="flex: 1; overflow-y: auto; padding: 15px 20px;"></div>
                <div id="os-results-controls" style="padding: 15px 20px; border-top: 1px solid #eee; background-color: white;">
                    <div style="display: flex; justify-content: space-between; gap: 10px;">
                        <button type="button" id="os-prev-btn" style="padding: 8px 15px; background-color: #f0f0f0; color: #333; border: none; border-radius: 4px; cursor: pointer; font-family: Arial, sans-serif; flex: 1;">Previous</button>
                        <button type="button" id="os-back-search-btn" style="padding: 8px 15px; background-color: #f0f0f0; color: #333; border: none; border-radius: 4px; cursor: pointer; font-family: Arial, sans-serif; flex: 1;">Back to Search</button>
                        <button type="button" id="os-next-btn" style="padding: 8px 15px; background-color: #00a1d6; color: white; border: none; border-radius: 4px; cursor: pointer; font-family: Arial, sans-serif; flex: 1;">Next</button>
                    </div>
                    <div id="os-pagination-info" style="text-align: center; margin-top: 10px; font-family: Arial, sans-serif; font-size: 14px; color: #666;"></div>
                </div>
            </div>
            `;
            resultsOverlay.appendChild(resultsModal);


            // Create settings modal - moved to section below createUI for better flow
            createSettingsModal();

            // Add elements to the page
            document.body.appendChild(button);
            document.body.appendChild(loginOverlay);
            document.body.appendChild(searchOverlay);
            document.body.appendChild(resultsOverlay); // Append results overlay
            document.body.appendChild(document.getElementById("opensubtitles-settings-overlay")); // Append settings overlay (assuming it's already created by createSettingsModal)


            // --- Event Listeners ---
            document
                .getElementById("opensubtitles-login-btn")
                .addEventListener("click", handleButtonClick);

            // Login modal events
            document
                .getElementById("os-cancel-btn")
                .addEventListener("click", hideLoginModal);
            document
                .getElementById("opensubtitles-login-form")
                .addEventListener("submit", handleLogin);

            // Search modal events
            document
                .getElementById("os-search-cancel-btn")
                .addEventListener("click", hideSearchModal);
            document
                .getElementById("os-search-submit-btn")
                .addEventListener("click", () =>
                    document
                        .getElementById("opensubtitles-search-form")
                        .dispatchEvent(new Event("submit", { cancelable: true }))
                ); // Trigger submit
            document
                .getElementById("opensubtitles-search-form")
                .addEventListener("submit", handleSubtitleSearch);
            document
                .getElementById("os-settings-btn")
                .addEventListener("click", showSettingsModal); // Settings button in search modal

            // Results modal events
            document
                .getElementById("os-prev-btn")
                .addEventListener("click", () => navigateResults("prev"));
            document
                .getElementById("os-next-btn")
                .addEventListener("click", () => navigateResults("next"));
            document
                .getElementById("os-back-search-btn")
                .addEventListener("click", backToSearch);

            // Settings modal events are already attached in createSettingsModal function

            // Click outside to close modals
            loginOverlay.addEventListener("click", (e) => {
                if (e.target === loginOverlay) hideLoginModal();
            });
            searchOverlay.addEventListener("click", (e) => {
                if (e.target === searchOverlay) hideSearchModal();
            });
            resultsOverlay.addEventListener("click", (e) => {
                if (e.target === resultsOverlay) hideResultsModal();
            });
            document.getElementById("opensubtitles-settings-overlay").addEventListener("click", (e) => {
                if (e.target === document.getElementById("opensubtitles-settings-overlay")) hideSettingsModal();
            });

            // Prevent scrolling behind modals
            addModalScrollPrevention("os-search-form-container");
            addModalScrollPrevention("os-search-results-container");
            addModalScrollPrevention("os-results-container");

            // Add Enter key support for search inputs
            addEnterKeyListener("os-query");
            addEnterKeyListener("os-languages");

        } catch (error) {
            console.error("Error in createUI:", error);
        }
    }

    // --- Event Handlers for Settings Modal ---

    // Update the toggle event handlers to properly update visual state
    function handleBgToggleChange(e) {
        const isChecked = e.target.checked;
        updateBgOptionsVisibility(isChecked);

        // Update the visual appearance of the toggle
        e.target.nextElementSibling.style.backgroundColor = isChecked 
            ? "#00a1d6" 
            : "#ccc";
        e.target.nextElementSibling.querySelector("span").style.transform = 
            isChecked ? "translateX(20px)" : "";
    }

    function handleOutlineToggleChange(e) {
        const isChecked = e.target.checked;
        updateOutlineOptionsVisibility(isChecked);

        // Update the visual appearance of the toggle
        e.target.nextElementSibling.style.backgroundColor = isChecked 
            ? "#00a1d6" 
            : "#ccc";
        e.target.nextElementSibling.querySelector("span").style.transform = 
            isChecked ? "translateX(20px)" : "";
    }

    function handleFontHexColorInput(e) {
        const color = e.target.value;
        if (/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)) {
            setFontColor(color);
            clearFontColorSelection();
            setInputVal("os-custom-font-color", color);
        }
    }

    function handleFontColorPickerInput(e) {
        setInputVal("os-hex-color-input", e.target.value);
        setFontColor(e.target.value);
        clearFontColorSelection();
        document.getElementById("os-custom-color-container").style.border =
            "2px solid #00a1d6";
    }

    function handleSyncValueInput(e) {
        const value = parseFloat(e.target.value);
        if (value >= -30 && value <= 30) {
            setInputVal("os-sync-slider", value);
        } else if (value < -30) {
            setInputVal("os-sync-slider", -30);
        } else if (value > 30) {
            setInputVal("os-sync-slider", 30);
        }
    }

    function resetSyncSettings() {
        setInputVal("os-sync-slider", 0);
        setInputVal("os-sync-value", 0);
    }

    function handleBgColorPickerInput(e) {
        setBgColor(e.target.value);
        clearBgColorSelection();
        setInputVal("os-bg-hex-color-input", e.target.value);
        document.getElementById("os-bg-color-container").style.border =
            "2px solid #00a1d6";
    }

    function handleBgHexColorInput(e) {
        const color = e.target.value;
        if (/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)) {
            setBgColor(color);
            clearBgColorSelection();
            setInputVal("os-custom-bg-color", color);
            document.getElementById("os-bg-color-container").style.border =
                "2px solid #00a1d6";
        }
    }

    function handleOutlineHexColorInput(e) {
        const color = e.target.value;
        if (/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)) {
            setOutlineColor(color);
            clearOutlineColorSelection();
            setInputVal("os-custom-outline-color", color);
            document.getElementById("os-outline-color-container").style.border =
                "2px solid #00a1d6";
        }
    }

    function handleOutlineColorPickerInput(e) {
        setInputVal("os-outline-hex-color-input", e.target.value);
        setOutlineColor(e.target.value);
        clearOutlineColorSelection();
        document.getElementById("os-outline-color-container").style.border =
            "2px solid #00a1d6";
    }

    // --- Helper Functions for UI Events ---

    // Update visibility of background options in settings modal
    function updateBgOptionsVisibility(isVisible) {
        setDisplay("os-bg-options", isVisible ? "block" : "none");
    }

    // Update visibility of outline options in settings modal
    function updateOutlineOptionsVisibility(isVisible) {
        setDisplay("os-outline-options", isVisible ? "block" : "none");
    }

    // Prevent page scrolling when modal scroll reaches boundaries
    function addModalScrollPrevention(containerId) {
        const container = document.getElementById(containerId);
        if (container) {
            container.addEventListener(
                "wheel",
                (e) => {
                    const { scrollTop, scrollHeight, clientHeight } = container;
                    if (
                        (scrollTop <= 0 && e.deltaY < 0) ||
                        (Math.abs(scrollHeight - clientHeight - scrollTop) <
                            1 &&
                            e.deltaY > 0)
                    ) {
                        e.preventDefault();
                    }
                },
                { passive: false }
            );
        }
    }

    // Add Enter key listener to input fields
    function addEnterKeyListener(inputId) {
        const input = document.getElementById(inputId);
        if (input) {
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    document
                        .getElementById("opensubtitles-search-form")
                        .dispatchEvent(new Event("submit"));
                }
            });
        }
    }

    // --- API Interaction Functions ---

    // Get API headers with optional token
    function getApiHeaders(token = null, apiKey = API_KEY) {
        const headers = {
            "Content-Type": "application/json",
            "Api-Key": apiKey,
            "User-Agent": USER_AGENT,
        };
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }
        return headers;
    }

    // Get user info from API
    async function getUserInfo() {
        try {
            const tokenData = await getToken();
            if (!tokenData?.token) {
                console.error("No valid token found");
                return null;
            }

            const apiEndpoint =
                tokenData.base_url === "vip-api.opensubtitles.com"
                    ? VIP_API_ENDPOINT
                    : PUBLIC_API_ENDPOINT;
            const response = await fetch(`${apiEndpoint}/infos/user`, {
                headers: getApiHeaders(tokenData.token),
            });

            if (!response.ok) {
                console.error("Failed to get user info:", response.status);
                return null;
            }

            const data = await response.json();
            if (data?.data) {
                await storeUserInfo(data.data); // Store user data in IndexedDB
                return data.data;
            }
            return null;
        } catch (error) {
            console.error("Error getting user info:", error);
            return null;
        }
    }

    // Store user info in IndexedDB
    async function storeUserInfo(userData) {
        try {
            const db = await openDatabase();
            const store = db
                .transaction([SETTINGS_STORE_NAME], "readwrite")
                .objectStore(SETTINGS_STORE_NAME);
            userData.id = "userInfo";
            userData.timestamp = Date.now();
            store.put(userData);
        } catch (error) {
            console.error("Error storing user info:", error);
            throw error;
        }
    }

    // Get user info from IndexedDB
    async function getUserInfoFromDB() {
        try {
            const db = await openDatabase();
            if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) return null; // Check if store exists

            const store = db
                .transaction([SETTINGS_STORE_NAME], "readonly")
                .objectStore(SETTINGS_STORE_NAME);
            const request = store.get("userInfo");

            return new Promise((resolve) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null); // Resolve null on error
            });
        } catch (error) {
            console.error("Error retrieving user info:", error);
            return null;
        }
    }

    // Show login modal
    function showLoginModal() {
        setDisplay("opensubtitles-login-overlay", "flex");
        setDisplay("os-login-status", "none");
        const loginForm = document.getElementById("opensubtitles-login-form");
        if (loginForm) {
            loginForm.reset();
        }
    }

    // Hide login modal
    function hideLoginModal() {
        setDisplay("opensubtitles-login-overlay", "none");
    }

    // Show search modal
    function showSearchModal() {
        setDisplay("opensubtitles-search-overlay", "flex");
        setDisplay("os-search-form-container", "block");
        setDisplay("os-search-results-container", "none");
    }

    // Hide search modal
    function hideSearchModal() {
        setDisplay("opensubtitles-search-overlay", "none");
        setDisplay("os-search-status", "none");
        setDisplay("os-search-results-container", "none");
        document.getElementById("os-search-results-container").innerHTML = "";
        setDisplay("os-search-form-container", "block");
    }

    // Handle login form submission
    async function handleLogin(e) {
        e.preventDefault();

        const token = document.getElementById("os-token").value.trim();

        if (!token) {
            updateLoginStatusUI("Please enter your API token", "#e74c3c");
            return;
        }

        updateLoginStatusUI("Verifying token...", "#3498db", "block");

        try {
            console.log("Starting token verification...");

            // First test the API endpoint directly
            const apiEndpoint = "https://api.opensubtitles.com/api/v1";
            console.log("Fetching user info from API...");

            const response = await fetch(`${apiEndpoint}/infos/user`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "Api-Key": API_KEY,
                    Authorization: `Bearer ${token}`,
                    "User-Agent": USER_AGENT,
                },
            });

            console.log("API response status:", response.status);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(
                    `API error (${response.status}): ${
                        errorData.message || response.statusText
                    }`
                );
            }

            const userData = await response.json();
            console.log("User data retrieved successfully");

            if (!userData?.data) {
                throw new Error("Invalid API response format");
            }

            // Store the token data first
            console.log("Storing token data...");
            await storeToken({
                token: token,
                base_url: "api.opensubtitles.com",
                timestamp: Date.now(),
            });

            // Then store the user info
            console.log("Storing user info...");
            await storeUserInfo({
                ...userData.data,
                id: "userInfo",
                timestamp: Date.now(),
            });

            console.log("Login successful");
            updateLoginStatusUI("Login successful!", "#2ecc71");
            updateButtonToSubtitles(); // Update button state immediately
            setTimeout(hideLoginModal, 1500);
        } catch (error) {
            console.error("Login error:", error);
            updateLoginStatusUI(
                "Login failed: " + (error.message || "Please try again later."),
                "#e74c3c",
                "block"
            );
        }
    }

    // Update login status UI
    function updateLoginStatusUI(message, color, display = "block") {
        const statusElement = document.getElementById("os-login-status");
        statusElement.textContent = message;
        statusElement.style.color = color;
        statusElement.style.display = display;
    }

    // Handle subtitle search submission
    async function handleSubtitleSearch(e) {
        e.preventDefault();

        const query = document.getElementById("os-query").value.trim();

        updateSearchStatusUI("Searching...", "#3498db", "block");

        try {
            const tokenData = await getToken();
            if (!tokenData?.token || !tokenData?.apiKey) {
                updateSearchStatusUI(
                    "Authentication error. Please log in again.",
                    "#e74c3c"
                );
                return;
            }

            const apiEndpoint =
                tokenData.base_url === "vip-api.opensubtitles.com"
                    ? VIP_API_ENDPOINT
                    : PUBLIC_API_ENDPOINT;
            const params = buildSearchParams();
            currentSearchParams = params.toString(); // Store for pagination

            const response = await fetch(
                `${apiEndpoint}/subtitles?${params.toString()}`,
                { headers: getApiHeaders(tokenData.token, tokenData.apiKey) }
            );
            const data = await response.json();

            if (response.ok) {
                updateSearchStatusUI("", "", "none");
                createResultsModal(); // Ensure results modal exists
                updatePaginationState(data);
                currentSearchQuery = query;
                updateResultsSummary();
                displayCurrentPage();
                showResultsModal();
            } else {
                updateSearchStatusUI(
                    data.message || "Search failed. Please try again.",
                    "#e74c3c"
                );
            }
        } catch (error) {
            console.error("OpenSubtitles search error:", error);
            updateSearchStatusUI(
                "Search failed. Please try again later.",
                "#e74c3c"
            );
        }
    }

    // Update search status UI
    function updateSearchStatusUI(message, color, display = "block") {
        const statusElement = document.getElementById("os-search-status");
        statusElement.textContent = message;
        statusElement.style.color = color;
        statusElement.style.display = display;
    }

    // Build search parameters from form
    function buildSearchParams() {
        const params = new URLSearchParams();
        const form = document.getElementById("opensubtitles-search-form");
        const formData = new FormData(form);
        const paramFields = [
            "ai_translated",
            "episode_number",
            "foreign_parts_only",
            "hearing_impaired",
            "id",
            "imdb_id",
            "machine_translated",
            "moviehash",
            "moviehash_match",
            "order_by",
            "order_direction",
            "page",
            "season_number",
            "tmdb_id",
            "trusted_sources",
            "type",
            "year",
        ];

        if (formData.get("query"))
            params.append("query", formData.get("query"));
        if (formData.get("languages"))
            params.append("languages", formData.get("languages"));

        paramFields.forEach((field) => {
            const value = formData.get(field)?.trim();
            if (value) params.append(field, value);
        });
        return params;
    }

    // Get subtitle from IndexedDB cache
    async function getSubtitleFromCache(subtitleId) {
        try {
            const db = await openDatabase();
            const store = db
                .transaction([SUBTITLES_STORE_NAME], "readonly")
                .objectStore(SUBTITLES_STORE_NAME);
            const request = store.get(subtitleId);
            return new Promise((resolve) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null); // Resolve null on error
            });
        } catch (error) {
            console.error("Error retrieving subtitle from cache:", error);
            return null;
        }
    }

    // Handle subtitle download and application to video
    async function handleSubtitleDownload(subtitleId) {
        // Prevent multiple simultaneous downloads
        if (subtitleApplicationInProgress) {
            console.log("Subtitle application already in progress, ignoring duplicate request");
            return;
        }
        
        subtitleApplicationInProgress = true;
        
        try {
            const result = currentSearchResults.find((r) => r.id === subtitleId);
            if (!result) {
                console.error("Subtitle not found in current results");
                subtitleApplicationInProgress = false;
                return;
            }
    
            const button = document.querySelector(
                `.os-download-btn[data-subtitle-id="${subtitleId}"]`
            );
            if (button) {
                setDownloadButtonLoading(button);
            }
    
            try {
                // Pre-emptively clean up any existing subtitles
                const videoPlayer = document.querySelector('video');
                if (videoPlayer) {
                    clearExistingSubtitles(videoPlayer);
                    // Add a small delay to ensure DOM operations complete
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
    
                const cachedSubtitle = await getSubtitleFromCache(subtitleId);
                const subtitleData =
                    cachedSubtitle || (await fetchSubtitleData(subtitleId, result));
    
                if (!subtitleData) {
                    setDownloadButtonError(button);
                    subtitleApplicationInProgress = false;
                    return;
                }
    
                // Apply the subtitle content to the video
                const success = await applySubtitleToVideo(subtitleData.content);
    
                if (success) {
                    // Update button to show cached state
                    if (button) {
                        setDownloadButtonSuccess(button);
                    }
    
                    // Also update the item container to show cached status if not already showing
                    const itemContainer =
                        button.closest("[data-subtitle-id]") ||
                        button.closest(".os-download-btn").parentElement.parentElement;
                    if (itemContainer) {
                        // Your existing container update code
                    }
    
                    hideResultsModal(); // Close the results modal on successful application
                } else {
                    setDownloadButtonError(button);
                }
            } catch (error) {
                console.error("Error downloading subtitle:", error);
                if (button) {
                    setDownloadButtonError(button);
                }
            }
        } finally {
            // Always release the lock when done, even if there's an error
            subtitleApplicationInProgress = false;
        }
    }

    // Add this new function for error state
    function setDownloadButtonError(button) {
        if (!button) return;

        // Save original styles to restore later
        const originalBg = button.style.backgroundColor;

        button.disabled = false; // Keep button enabled so user can retry
        button.innerHTML = `Error`;
        button.style.backgroundColor = "#e74c3c"; // Red background

        // Restore button after 3 seconds but keep it functional during this time
        setTimeout(() => {
            button.innerHTML = "Select";
            button.style.backgroundColor = originalBg;
        }, 3000);
    }


    // Store subtitle in IndexedDB cache (LRU strategy)
    async function storeSubtitle(subtitleData) {
        try {
            const db = await openDatabase();
            const store = db
                .transaction([SUBTITLES_STORE_NAME], "readwrite")
                .objectStore(SUBTITLES_STORE_NAME);

            const count = await countSubtitlesInCache(store);
            if (count >= SUBTITLE_CACHE_SIZE) {
                await evictOldestSubtitles(
                    store,
                    count - (SUBTITLE_CACHE_SIZE - 1)
                ); // Evict to make space
            }
            store.put(subtitleData);
        } catch (error) {
            console.error("Error storing subtitle:", error);
            throw error;
        }
    }

    // Count subtitles in cache
    async function countSubtitlesInCache(store) {
        const countRequest = store.count();
        return await new Promise((resolve, reject) => {
            countRequest.onsuccess = () => resolve(countRequest.result);
            countRequest.onerror = (event) => reject(event.target.error);
        });
    }

    // Evict oldest subtitles from cache
    async function evictOldestSubtitles(store, deleteCount) {
        const allSubtitles = await getAllSubtitlesSortedByTimestamp(store);
        for (let i = 0; i < deleteCount; i++) {
            await deleteSubtitleFromCache(store, allSubtitles[i].id);
        }
    }

    // Get all subtitles sorted by timestamp
    async function getAllSubtitlesSortedByTimestamp(store) {
        return await new Promise((resolve, reject) => {
            const subtitlesRequest = store
                .index("timestamp")
                .openCursor(null, "next");
            const subtitles = [];
            subtitlesRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    subtitles.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(subtitles);
                }
            };
            subtitlesRequest.onerror = (event) => reject(event.target.error);
        });
    }

    // Delete subtitle from cache by ID
    async function deleteSubtitleFromCache(store, subtitleId) {
        return await new Promise((resolve, reject) => {
            const deleteRequest = store.delete(subtitleId);
            deleteRequest.onsuccess = () => resolve();
            deleteRequest.onerror = (event) => reject(event.target.error);
        });
    }

    // Apply subtitle to BiliBili video player
    async function applySubtitleToVideo(subtitleContent) {
        // Check if another application is in progress (redundant safety check)
        if (subtitleApplicationInProgress && window.activeCues) {
            console.log("Another subtitle application is already in progress");
            return false;
        }
        
        // Cancel any existing animation frames first
        if (window.subtitleUpdateAnimationFrame) {
            cancelAnimationFrame(window.subtitleUpdateAnimationFrame);
            window.subtitleUpdateAnimationFrame = null;
        }
    
        const videoPlayer = document.querySelector('video');
        if (!videoPlayer) {
            console.error("BiliBili video player not found");
            return false;
        }
    
        const videoContainer = videoPlayer.closest(".bpx-player-video-wrap");
        if (!videoContainer) {
            console.error("BiliBili video container not found");
            return false;
        }
    
        // More thorough cleanup with a small delay to ensure DOM operations complete
        clearExistingSubtitles(videoPlayer);
        await new Promise(resolve => setTimeout(resolve, 20));
        
        // Double-check that everything is gone
        document.querySelectorAll(".bilibili-subtitles-overlay").forEach(el => el.remove());
        document.querySelectorAll("[id^='bilibili-subtitles-']").forEach(el => el.remove());
    
        // Also try to disable native bilibili subtitles if present
        try {
            const nativeBilibiliSubtitles = document.querySelector('.bpx-player-subtitle-wrap');
            if (nativeBilibiliSubtitles) {
                nativeBilibiliSubtitles.style.display = 'none';
            }
        } catch (e) {
            console.log("No native bilibili subtitles found to disable:  " + e);
        }
    
        let settings = await loadSettingsFromIndexedDB(); // Load settings from IndexedDB
    
        // Create a fresh subtitle overlay with a unique timestamp to avoid conflicts
        const uniqueId = Date.now();
        const overlayContainer = createSubtitleOverlay(settings, uniqueId);
        const subtitleElement = overlayContainer.querySelector(
            `#bilibili-subtitles-draggable-${uniqueId}`
        );
        const subtitleTextElement = subtitleElement.querySelector(
            `#bilibili-subtitles-text-${uniqueId}`
        );
    
        videoContainer.appendChild(overlayContainer); // Append overlay to video container
        setupSubtitleDrag(subtitleElement); // Setup draggable subtitles
    
        window.subtitleSyncOffset = settings.syncOffset || 0; // Store sync offset
    
        return await parseAndDisplaySubtitles(
            subtitleContent,
            videoPlayer,
            subtitleTextElement
        );
    }

    // Clear existing OpenSubtitles tracks and overlay
    function clearExistingSubtitles(videoPlayer) {
        // Cancel any existing animation frames first
        if (window.subtitleUpdateAnimationFrame) {
            cancelAnimationFrame(window.subtitleUpdateAnimationFrame);
            window.subtitleUpdateAnimationFrame = null;
        }
        
        // Remove track elements
        if (videoPlayer) {
            videoPlayer
                .querySelectorAll('track[label="OpenSubtitles"]')
                .forEach((track) => {
                    URL.revokeObjectURL(track.src);
                    track.remove();
                });
        }
    
        // Remove ALL existing subtitle overlays from the entire document
        document.querySelectorAll(".bilibili-subtitles-overlay").forEach(el => {
            try {
                el.remove();
            } catch (e) {
                console.error("Error removing overlay:", e);
            }
        });
    
        // Also look for elements by ID pattern to ensure complete removal
        document.querySelectorAll("[id^='bilibili-subtitles-']").forEach(el => {
            // Only remove if it's not a child of something we already removed
            if (document.body.contains(el)) {
                try {
                    el.remove();
                } catch (e) {
                    console.error("Error removing element:", e);
                }
            }
        });
        
        // Reset global variables
        window.activeCues = null;
    }

    // Create subtitle overlay container element
    function createSubtitleOverlay(settings, uniqueId = Date.now()) {
        const overlayContainer = createDiv(
            `bilibili-subtitles-overlay-${uniqueId}`,
            "",
            `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 10;
            `
        );
        
        // Add class for easier selection when clearing
        overlayContainer.classList.add("bilibili-subtitles-overlay");
    
        const subtitleElement = createDiv(
            `bilibili-subtitles-draggable-${uniqueId}`,
            "",
            `
            position: absolute;
            bottom: 50px;
            left: 50%;
            transform: translateX(-50%);
            ${
                settings.bgEnabled
                    ? (() => {
                          const [r, g, b] = hexToRgb(
                              settings.bgColor || "#000000"
                          );
                          return `padding: 5px 10px; background-color: rgba(${r}, ${g}, ${b}, ${settings.bgOpacity});`;
                      })()
                    : "padding: 0; background-color: transparent;"
            }
            color: ${settings.fontColor};
            border-radius: 4px;
            text-align: center;
            max-width: 90%;
            width: auto;
            display: inline-block;
            pointer-events: auto;
            cursor: move;
            user-select: text;
            `
        );
    
        const subtitleTextElement = createDiv(
            `bilibili-subtitles-text-${uniqueId}`,
            "",
            `
            font-family: Arial, sans-serif;
            font-size: ${Math.max(1, settings.fontSize)}px; /* Ensure minimum 1px */
            line-height: 1.2;
            color: ${settings.fontColor};
            white-space: normal;
            word-wrap: break-word;
            overflow-wrap: break-word;
            display: inline;
            ${
                settings.outlineEnabled
                    ? `text-shadow: -1px -1px 0 ${settings.outlineColor}, 1px -1px 0 ${settings.outlineColor}, -1px 1px 0 ${settings.outlineColor}, 1px 1px 0 ${settings.outlineColor};`
                    : ""
            }
            `
        );
    
        subtitleElement.appendChild(subtitleTextElement);
        overlayContainer.appendChild(subtitleElement);
        return overlayContainer;
    }

    // Setup drag functionality for subtitle element
    function setupSubtitleDrag(subtitleElement) {
        let isDragging = false;
        // Variables to store initial element and mouse positions
        let initialMouseX, initialMouseY;
        let initialElementX, initialElementY;
        let elementWidth, elementHeight;
        
        // Remove all transition effects
        subtitleElement.style.transition = "none";
        
        // Prevent clicks from reaching the video and toggling play/pause
        subtitleElement.addEventListener("click", (e) => {
            e.stopPropagation();
        });
        
        subtitleElement.addEventListener("mousedown", (e) => {
            // Stop event propagation to prevent video pause/play
            e.stopPropagation();
            e.preventDefault();
            
            // Store initial mouse position
            initialMouseX = e.clientX;
            initialMouseY = e.clientY;
            
            // Get video container dimensions for boundary checking
            const videoPlayer = document.querySelector('video');
            if (!videoPlayer) return;
            
            const videoRect = videoPlayer.getBoundingClientRect();
            
            // Get the current position of the element
            const elementRect = subtitleElement.getBoundingClientRect();
            elementWidth = elementRect.width;
            elementHeight = elementRect.height;
            
            // Calculate the current position relative to the video
            initialElementX = elementRect.left - videoRect.left;
            initialElementY = elementRect.top - videoRect.top;
            
            isDragging = true;
            
            // Ensure no transition during dragging
            subtitleElement.style.transition = "none";
            
            // Pause subtitle updates during dragging to prevent flickering
            if (window.subtitleUpdateAnimationFrame) {
                cancelAnimationFrame(window.subtitleUpdateAnimationFrame);
                window.subtitleUpdateAnimationFrame = null;
            }
            
            // Change cursor style
            document.body.style.cursor = "grabbing";
        });
        
        document.addEventListener("mousemove", (e) => {
            if (!isDragging) return;
            
            // Get the current mouse position
            const currentMouseX = e.clientX;
            const currentMouseY = e.clientY;
            
            // Calculate how much the mouse has moved
            const deltaX = currentMouseX - initialMouseX;
            const deltaY = currentMouseY - initialMouseY;
            
            // Calculate the new position (initial position + mouse movement)
            let newX = initialElementX + deltaX;
            let newY = initialElementY + deltaY;
            
            // Get video boundaries for constraint checking
            const videoPlayer = document.querySelector('video');
            if (!videoPlayer) return;
            
            const videoRect = videoPlayer.getBoundingClientRect();
            
            // Get subtitle text element to adjust width if needed
            const subtitleTextElement = subtitleElement.querySelector('[id^="bilibili-subtitles-text-"]');
            
            // Calculate center position and snap zone
            const centerX = videoRect.width / 2 - elementWidth / 2;
            const snapThreshold = 20; // Pixels from center to trigger snap
            
            // Check if the element is close to the center
            const distanceFromCenter = Math.abs(newX - centerX);
            if (distanceFromCenter < snapThreshold) {
                // Snap to center
                newX = centerX;
                // Visual indicator that we're snapped to center (optional)
                if (subtitleTextElement) {
                    subtitleTextElement.style.textAlign = "center";
                }
            }
            
            // Apply boundary constraints
            // Left boundary - allow subtitle to touch left edge exactly
            if (newX < 0) {
                newX = 0;
                
                // Adjust subtitle text width when touching left edge to ensure content fits
                if (subtitleTextElement) {
                    subtitleTextElement.style.maxWidth = `${videoRect.width * 0.8}px`;
                    subtitleTextElement.style.whiteSpace = "normal";
                    subtitleTextElement.style.textAlign = "left";
                }
            } 
            // Right boundary - allow subtitle to touch right edge exactly
            else if (newX + elementWidth > videoRect.width) {
                newX = videoRect.width - elementWidth;
                
                // Adjust subtitle text width when touching right edge to ensure content fits
                if (subtitleTextElement) {
                    subtitleTextElement.style.maxWidth = `${videoRect.width * 0.8}px`;
                    subtitleTextElement.style.whiteSpace = "normal";
                    subtitleTextElement.style.textAlign = "right";
                }
            }
            // Center positioning when not at edges and not snapped to center
            else if (subtitleTextElement && Math.abs(newX - centerX) >= snapThreshold) {
                subtitleTextElement.style.maxWidth = "";
                subtitleTextElement.style.whiteSpace = "normal";
                subtitleTextElement.style.textAlign = "center";
            }
            
            // Top boundary
            if (newY < 0) newY = 0;
            // Bottom boundary
            if (newY + elementHeight > videoRect.height) newY = videoRect.height - elementHeight;
            
            // Apply the absolute position to avoid jittering
            subtitleElement.style.position = 'absolute';
            subtitleElement.style.transform = 'none';
            subtitleElement.style.left = newX + 'px';
            subtitleElement.style.top = newY + 'px';
            subtitleElement.style.bottom = 'auto';
        });
        
        document.addEventListener("mouseup", () => {
            if (!isDragging) return;
            
            isDragging = false;
            
            // Resume subtitle updates
            const videoPlayer = document.querySelector('video');
            if (videoPlayer) {
                const subtitleTextElement = subtitleElement.querySelector('[id^="bilibili-subtitles-text-"]');
                if (subtitleTextElement && window.activeCues) {
                    setupSubtitleDisplay(window.activeCues, videoPlayer, subtitleTextElement);
                }
            }
            
            document.body.style.cursor = "";
        });
        
        // Handle if mouse leaves window
        document.addEventListener("mouseleave", () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.cursor = "";
                
                // Resume subtitle updates
                const videoPlayer = document.querySelector('video');
                if (videoPlayer) {
                    const subtitleTextElement = subtitleElement.querySelector('[id^="bilibili-subtitles-text-"]');
                    if (subtitleTextElement && window.activeCues) {
                        setupSubtitleDisplay(window.activeCues, videoPlayer, subtitleTextElement);
                    }
                }
            }
        });
    }

    // Parse and display subtitles (WebVTT or SRT)
    async function parseAndDisplaySubtitles(
        subtitleContent,
        videoPlayer,
        subtitleTextElement
    ) {
        try {
            const style = document.createElement("style");
            style.textContent = `@keyframes subtitleFadeIn { from { opacity: 0; } to { opacity: 1; } } .subtitle-fade-in { animation: subtitleFadeIn 0.3s ease-in-out; }`;
            if (!document.getElementById("subtitle-animation-style")) {
                // Prevent adding style every time
                style.id = "subtitle-animation-style";
                document.head.appendChild(style);
            }

            let subtitleCues = subtitleContent.trim().startsWith("WEBVTT")
                ? await parseWebVTTCues(subtitleContent, videoPlayer)
                : parseSRTCues(subtitleContent);

            // Store cues globally for resuming after drag
            window.activeCues = subtitleCues;

            setupSubtitleDisplay(
                subtitleCues,
                videoPlayer,
                subtitleTextElement
            ); // Setup display with parsed cues
            return true;
        } catch (error) {
            console.error("Error parsing subtitles:", error);
            return false;
        }
    }

    // Parse WebVTT subtitle content
    async function parseWebVTTCues(subtitleContent, videoPlayer) {
        const blob = new Blob([subtitleContent], { type: "text/vtt" });
        const url = URL.createObjectURL(blob);
        const track = createTrackElement(url); // Create track element
        videoPlayer.appendChild(track); // Append track to video player

        track.track.mode = "hidden"; // Load cues but don't display

        return new Promise((resolve) => {
            setTimeout(() => resolve(Array.from(track.track.cues)), 100); // Wait for cues to load
        });
    }

    // Create track element for WebVTT subtitles
    function createTrackElement(url) {
        const track = document.createElement("track");
        track.src = url;
        track.kind = "subtitles";
        track.label = "OpenSubtitles";
        track.default = true;
        track.style.display = "none"; // Hide track element
        return track;
    }

    // Parse SRT subtitle content
    function parseSRTCues(srtContent) {
        const srtRegex =
            /(\d+)\r?\n(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})\r?\n([\s\S]*?)(?=\r?\n\r?\n\d+|\r?\n\r?\n$|$)/g;
        const parsedCues = [];
        let match;
        while ((match = srtRegex.exec(srtContent)) !== null) {
            parsedCues.push({
                startTime: timeToSeconds(match[2]),
                endTime: timeToSeconds(match[3]),
                text: match[4].trim(),
            });
        }
        return parsedCues;
    }

    // Convert SRT time format to seconds
    function timeToSeconds(timeString) {
        const [hours, minutes, secondsMillis] = timeString.split(":");
        const [seconds, milliseconds] = secondsMillis.split(",");
        return (
            parseInt(hours) * 3600 +
            parseInt(minutes) * 60 +
            parseInt(seconds) +
            parseInt(milliseconds) / 1000
        );
    }

    // Setup subtitle display update loop
    function setupSubtitleDisplay(subtitleCues, videoPlayer, subtitleTextElement) {
        let currentCue = null;
    
        // Ensure updateSubtitles is not already running before starting a new loop
        if (window.subtitleUpdateAnimationFrame) {
            cancelAnimationFrame(window.subtitleUpdateAnimationFrame);
            window.subtitleUpdateAnimationFrame = null; // Reset the frame request ID
        }
    
        // Get animation settings
        const settings = loadSettingsFromIndexedDB();
        const animationDuration = settings.animationDuration || 0.3;
    
        // Create animation styles if they don't exist
        if (!document.getElementById("subtitle-animation-styles")) {
            const style = document.createElement("style");
            style.id = "subtitle-animation-styles";
            style.textContent = `
                @keyframes subtitleFadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes subtitleFadeOut { from { opacity: 1; } to { opacity: 0; } }
                @keyframes subtitleSlideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                @keyframes subtitleSlideDown { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                @keyframes subtitleZoomIn { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
                
                .subtitle-animation-fade {
                    animation: subtitleFadeIn ${animationDuration}s ease-in-out;
                }
                .subtitle-animation-slideUp {
                    animation: subtitleSlideUp ${animationDuration}s ease-out;
                }
                .subtitle-animation-slideDown {
                    animation: subtitleSlideDown ${animationDuration}s ease-out;
                }
                .subtitle-animation-zoom {
                    animation: subtitleZoomIn ${animationDuration}s ease-out;
                }
            `;
            document.head.appendChild(style);
        } else {
            // Update animation durations if styles already exist
            const styleElement = document.getElementById("subtitle-animation-styles");
            styleElement.textContent = styleElement.textContent.replace(
                /animation:.*?(\d+\.?\d*)s/g, 
                `animation: $1 ${animationDuration}s`
            );
        }
    
        function updateSubtitles() {
            const currentTime = videoPlayer.currentTime - (window.subtitleSyncOffset || 0);
            const activeCue = subtitleCues.find(
                (cue) => currentTime >= cue.startTime && currentTime < cue.endTime
            );
    
            if (activeCue !== currentCue) {
                // Remove any existing animation classes
                subtitleTextElement.classList.remove(
                    "subtitle-animation-fade",
                    "subtitle-animation-slideUp",
                    "subtitle-animation-slideDown",
                    "subtitle-animation-zoom"
                );
                
                // Apply new subtitle
                currentCue = activeCue;
                if (activeCue) {
                    subtitleTextElement.innerHTML = activeCue.text;
                    
                    // Only apply animation if enabled in settings
                    const settings = loadSettingsFromIndexedDB();
                    if (settings.animationEnabled) {
                        subtitleTextElement.classList.add("subtitle-animation-fade");
                    }
                } else {
                    subtitleTextElement.innerHTML = "";
                }
            }
    
            // Store reference to animation frame for proper cancellation
            window.subtitleUpdateAnimationFrame = requestAnimationFrame(updateSubtitles);
        }
    
        // Only call once - the function will recursively request the next frame
        updateSubtitles();
    }

    // --- IndexedDB Functions ---

    // Update the openDatabase function to include the new object store for quota info

    function openDatabase() {
        console.log("[Subtitle Selector] Opening IndexedDB database...");
        if (!window.indexedDB) {
            console.error("[Subtitle Selector] IndexedDB not supported");
            return Promise.reject(new Error("Your browser doesn't support IndexedDB"));
        }
        console.log("[Subtitle Selector] IndexedDB support detected");
    
        return new Promise((resolve, reject) => {
            try {
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                console.log(`[Subtitle Selector] Opening database ${DB_NAME} (v${DB_VERSION})...`);
                
                // Add initial state logging
                console.log("[Subtitle Selector] Initial request.readyState:", request.readyState);
    
                request.onerror = (event) => {
                    console.error("[Subtitle Selector] Database error:", event.target.error);
                    reject(new Error(`Database error: ${event.target.error.message}`));
                };
                console.log("[Subtitle Selector] database onerror event set");
    
                request.onblocked = (event) => {
                    console.warn("[Subtitle Selector] Database blocked, please close other tabs with this app");
                    reject(new Error("Database blocked. Close other tabs and try again: " + event.target.error.message));
                };
                console.log("[Subtitle Selector] database onblocked event set");
    
                request.onupgradeneeded = (event) => {
                    console.log(`[Subtitle Selector] Upgrading database from version ${event.oldVersion} to ${DB_VERSION}`);
                    const db = event.target.result;
                    try {
                        if (!db.objectStoreNames.contains(STORE_NAME)) {
                            const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
                            store.createIndex("token", "token", { unique: false });
                            console.log(`[Subtitle Selector] Created ${STORE_NAME} object store`);
                        }
                        if (!db.objectStoreNames.contains(SUBTITLES_STORE_NAME)) {
                            const subStore = db.createObjectStore(SUBTITLES_STORE_NAME, { keyPath: "id" });
                            subStore.createIndex("timestamp", "timestamp", { unique: false });
                            subStore.createIndex("language", "language", { unique: false });
                            console.log(`[Subtitle Selector] Created ${SUBTITLES_STORE_NAME} object store`);
                        }
                        if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
                            db.createObjectStore(SETTINGS_STORE_NAME, { keyPath: "id" });
                            console.log(`[Subtitle Selector] Created ${SETTINGS_STORE_NAME} object store`);
                        }
                    } catch (error) {
                        console.error("[Subtitle Selector] Error during database upgrade:", error);
                        throw error; // Ensure errors propagate to trigger onerror
                    }
                };
                console.log("[Subtitle Selector] database onupgradeneeded event set");
    
                request.onsuccess = (event) => {
                    const db = event.target.result;
                    console.log(`[Subtitle Selector] Database opened successfully (v${db.version})`);
                    db.onerror = (event) => {
                        console.error("[Subtitle Selector] Database error:", event.target.error);
                    };
                    resolve(db);
                };
                console.log("[Subtitle Selector] database onsuccess event set");
    
                // Add timeout to prevent hanging
                const timeoutMs = 5000; // 5 seconds
                setTimeout(() => {
                    if (request.readyState === "pending") {
                        console.error("[Subtitle Selector] Database open timed out after", timeoutMs, "ms");
                        reject(new Error("Database open timed out. Check browser console or close other tabs."));
                    }
                }, timeoutMs);
            } catch (error) {
                console.error("[Subtitle Selector] Error opening database:", error);
                reject(error);
            }
        });
    }

    // Optimized storeToken function
    async function storeToken(tokenData) {
        if (!tokenData?.token) throw new Error("Invalid token data provided");

        try {
            console.log("Opening database to store token...");
            const db = await openDatabase();
            console.log("Database opened successfully");

            console.log("Starting transaction to store token...");
            const transaction = db.transaction([STORE_NAME], "readwrite");
            const store = transaction.objectStore(STORE_NAME);

            console.log("Putting token in store...");
            const request = store.put({
                id: "current",
                token: tokenData.token,
                apiKey: API_KEY,
                base_url: tokenData.base_url || "api.opensubtitles.com",
                timestamp: Date.now(),
            });

            return new Promise((resolve, reject) => {
                request.onsuccess = () => {
                    console.log("Token stored successfully");
                    resolve();
                };
                request.onerror = (event) => {
                    console.error("Error storing token:", event.target.error);
                    reject(event.target.error);
                };
                transaction.oncomplete = () => {
                    console.log("Token transaction completed");
                };
                transaction.onerror = (event) => {
                    console.error(
                        "Token transaction error:",
                        event.target.error
                    );
                };
            });
        } catch (error) {
            console.error("Error in storeToken:", error);
            throw error;
        }
    }

    // Helper function to run IndexedDB requests as Promises
    function runIDBRequest(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Get token from IndexedDB
    async function getToken() {
        try {
            const db = await openDatabase();
            if (!db.objectStoreNames.contains(STORE_NAME)) return null; // Check if store exists

            const store = db
                .transaction([STORE_NAME], "readonly")
                .objectStore(STORE_NAME);
            return await runIDBRequest(store.get("current"));
        } catch (error) {
            console.error("Error retrieving token:", error);
            return null;
        }
    }

    // Check token validity (expiry) - now with server verification
    async function checkToken() {
        try {
            const tokenData = await getToken();
            if (!tokenData?.token) {
                console.log('No token found');
                return false;
            }

            const tokenAge = Date.now() - (tokenData.timestamp || 0);
            const isLocallyValid = tokenAge < TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

            if (isLocallyValid) {
                console.log('Token is valid based on local timestamp');
                return true;
            } 

            // Token appears expired based on local timestamp, verify with server
            console.log('Token appears expired based on local timestamp, checking with server...');

            // Make API call to verify token
            const apiEndpoint = tokenData.base_url === 'vip-api.opensubtitles.com' ? VIP_API_ENDPOINT : PUBLIC_API_ENDPOINT;

            try {
                const response = await fetch(`${apiEndpoint}/infos/user`, {
                    headers: getApiHeaders(tokenData.token, tokenData.apiKey)
                });

                if (response.ok) {
                    // Token is still valid on the server
                    console.log('API verification successful - token is still valid');

                    // Update token timestamp to extend local validity
                    const updatedTokenData = {
                        ...tokenData,
                        timestamp: Date.now() // Reset timestamp to now
                    };
                    await storeToken(updatedTokenData);

                    return true;
                } else {
                    console.log('API verification failed - token is expired or invalid');
                    return false;
                }
            } catch (error) {
                console.error('Error during token verification with server:', error);
                // On network errors, we'll be cautious and still consider the token valid
                // This prevents logouts due to temporary network issues
                return true;
            }
        } catch (error) {
            console.error('Error validating token:', error);
            return false;
        }
    }

    // Update button to "Subtitles" mode
    function updateButtonToSubtitles() {
        const button = document.getElementById("opensubtitles-login-btn");
        if (button) {
            button.textContent = "Subtitles";
            button.style.backgroundColor = "#2ecc71";
            // No need to remove/add event listeners as handleButtonClick is already the handler
            // and it will correctly route based on token status
        }
    }

    function createSettingsModal() {
        const settingsOverlay = createDiv(
            "opensubtitles-settings-overlay",
            "",
            `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            z-index: 10001;
            display: none;
            justify-content: center;
            align-items: center;
        `
        );

        const settingsModal = createDiv(
            "opensubtitles-settings-modal",
            "",
            `
            background-color: white;
            padding: 0;
            border-radius: 6px;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
            width: 500px;
            max-width: 90%;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        `
        );

        const notificationPopup = createDiv(
            "os-settings-notification",
            "Settings saved successfully!",
            `
            position: fixed;
            top: 20px;
            right: 20px;
            background-color: #2ecc71;
            color: white;
            padding: 12px 20px;
            border-radius: 4px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
            font-family: Arial, sans-serif;
            font-size: 14px;
            z-index: 10002;
            opacity: 0;
            transform: translateY(-20px);
            transition: all 0.3s ease;
            pointer-events: none;
        `
        );
        document.body.appendChild(notificationPopup);

        settingsModal.innerHTML = `
            <div id="os-settings-header" style="padding: 15px 20px; border-bottom: 1px solid #eee; background-color: #f9f9f9; display: flex; justify-content: space-between; align-items: center;">
                <h2 style="margin: 0; color: #00a1d6; font-family: Arial, sans-serif; font-size: 18px;">Subtitle Settings</h2>
                <button id="os-settings-close-btn" style="background: none; border: none; cursor: pointer; padding: 5px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div id="os-settings-container" style="flex: 1; overflow-y: auto; padding: 15px 20px;">
                <!-- Account section -->
                <div style="margin-bottom: 20px;">
                    <h3 style="color: #00a1d6; font-family: Arial, sans-serif; font-size: 16px; margin-bottom: 10px;">Account</h3>
                    <div id="os-user-info" style="background-color: #f5f5f5; padding: 12px; border-radius: 4px; margin-bottom: 10px;">
                        <div style="display: grid; grid-template-columns: auto 1fr; gap: 10px; font-family: Arial, sans-serif; font-size: 14px;">
                            <div><strong>Status:</strong></div>
                            <div>
                                Loading...
                                <span id="os-user-vip-badge" style="background-color: #ffc107; color: #000; font-size: 11px; padding: 2px 6px; border-radius: 10px; margin-left: 5px; display: none;">VIP</span>
                            </div>

                            <div><strong>Downloads:</strong></div>
                            <div>- / - (- remaining)</div>

                            <div><strong>Reset Time:</strong></div>
                            <div>Unknown. Download to show.</div>

                            <div><strong>Last Update:</strong></div>
                            <div>Never</div>
                        </div>
                    </div>
                    <button id="os-refresh-user-info" style="padding: 8px 12px; background-color: #f0f0f0; color: #666; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-family: Arial, sans-serif; font-size: 14px;">
                        Refresh Information
                    </button>
                </div>

                <!-- Appearance section -->
                <div style="margin-bottom: 20px;">
                    <h3 style="color: #00a1d6; font-family: Arial, sans-serif; font-size: 16px; margin-bottom: 10px;">Subtitle Appearance</h3>

                    <!-- Font Size -->
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif; font-size: 14px;">Font Size:</label>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <button id="os-font-size-decrease" style="padding: 5px 10px; background-color: #f0f0f0; color: #333; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; width: 40px;">-</button>
                            <div id="os-font-size-value" style="flex: 1; text-align: center; font-family: Arial, sans-serif; font-size: 14px;">16px</div>
                            <button id="os-font-size-increase" style="padding: 5px 10px; background-color: #f0f0f0; color: #333; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; width: 40px;">+</button>
                        </div>
                    </div>

                    <!-- Font Color -->
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif; font-size: 14px;">Font Color:</label>
                        <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
                            <button class="os-font-color-btn" data-color="#FFFFFF" style="width: 30px; height: 30px; background-color: #FFFFFF; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;"></button>
                            <button class="os-font-color-btn" data-color="#FFFF00" style="width: 30px; height: 30px; background-color: #FFFF00; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;"></button>
                            <button class="os-font-color-btn" data-color="#00FFFF" style="width: 30px; height: 30px; background-color: #00FFFF; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;"></button>
                            <button class="os-font-color-btn" data-color="#FF9900" style="width: 30px; height: 30px; background-color: #FF9900; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;"></button>
                            <button class="os-font-color-btn" data-color="#FF00FF" style="width: 30px; height: 30px; background-color: #FF00FF; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;"></button>
                            <div id="os-custom-color-container" style="width: 30px; height: 30px; position: relative;">
                                <input type="color" id="os-custom-font-color" style="width: 30px; height: 30px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; padding: 0;">
                            </div>
                            <input type="text" id="os-hex-color-input" placeholder="#RRGGBB" pattern="^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$"
                                style="width: 80px; padding: 5px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace;">
                        </div>
                    </div>

                    <!-- Background Toggle -->
                    <div style="margin-bottom: 15px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <label for="os-bg-toggle" style="font-family: Arial, sans-serif; font-size: 14px;">Background:</label>
                            <label class="switch" style="position: relative; display: inline-block; width: 40px; height: 20px;">
                                <input type="checkbox" id="os-bg-toggle" checked style="opacity: 0; width: 0; height: 0;">
                                <span style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 20px;">
                                    <span style="position: absolute; content: ''; height: 16px; width: 16px; left: 2px; bottom: 2px; background-color: white; transition: .4s; border-radius: 50%;"></span>
                                </span>
                            </label>
                        </div>

                        <div id="os-bg-options" style="margin-top: 10px;">
                            <label style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif; font-size: 14px;">Background Color:</label>
                            <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px;">
                                <button class="os-bg-color-btn" data-color="#000000" style="width: 30px; height: 30px; background-color: #000000; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;"></button>
                                <button class="os-bg-color-btn" data-color="#333333" style="width: 30px; height: 30px; background-color: #333333; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;"></button>
                                <button class="os-bg-color-btn" data-color="#0000AA" style="width: 30px; height: 30px; background-color: #0000AA; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;"></button>
                                <button class="os-bg-color-btn" data-color="#AA0000" style="width: 30px; height: 30px; background-color: #AA0000; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;"></button>
                                <div id="os-bg-color-container" style="width: 30px; height: 30px; position: relative;">
                                    <input type="color" id="os-custom-bg-color" value="#000000" style="width: 30px; height: 30px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; padding: 0;">
                                </div>
                                <input type="text" id="os-bg-hex-color-input" placeholder="#RRGGBB" pattern="^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$"
                                    style="width: 80px; padding: 5px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace;">
                            </div>

                            <label style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif; font-size: 14px;">Opacity: <span id="os-bg-opacity-value">0.5</span></label>
                            <input type="range" id="os-bg-opacity" min="0" max="1" step="0.1" value="0.5" style="width: 100%;">
                        </div>
                    </div>

                    <!-- Text Outline -->
                    <div style="margin-bottom: 15px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <label for="os-outline-toggle" style="font-family: Arial, sans-serif; font-size: 14px;">Text Outline:</label>
                            <label class="switch" style="position: relative; display: inline-block; width: 40px; height: 20px;">
                                <input type="checkbox" id="os-outline-toggle" style="opacity: 0; width: 0; height: 0;">
                                <span style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 20px;">
                                    <span style="position: absolute; content: ''; height: 16px; width: 16px; left: 2px; bottom: 2px; background-color: white; transition: .4s; border-radius: 50%;"></span>
                                </span>
                            </label>
                        </div>

                        <div id="os-outline-options" style="margin-top: 10px; display: none;">
                            <label style="display: block; margin-bottom: 5px; font-family: Arial, sans-serif; font-size: 14px;">Outline Color:</label>
                            <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
                                <button class="os-outline-color-btn" data-color="#000000" style="width: 30px; height: 30px; background-color: #000000; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;"></button>
                                <button class="os-outline-color-btn" data-color="#FFFFFF" style="width: 30px; height: 30px; background-color: #FFFFFF; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;"></button>
                                <button class="os-outline-color-btn" data-color="#FF0000" style="width: 30px; height: 30px; background-color: #FF0000; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;"></button>
                                <div id="os-outline-color-container" style="width: 30px; height: 30px; position: relative;">
                                    <input type="color" id="os-custom-outline-color" value="#000000" style="width: 30px; height: 30px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; padding: 0;">
                                </div>
                                <input type="text" id="os-outline-hex-color-input" placeholder="#RRGGBB" pattern="^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$"
                                    style="width: 80px; padding: 5px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace;">
                            </div>
                        </div>
                    </div>

                    <!-- Animation Toggle - NEW SECTION -->
                    <div style="margin-bottom: 15px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <label for="os-animation-toggle" style="font-family: Arial, sans-serif; font-size: 14px;">Subtitle Animation:</label>
                            <label class="switch" style="position: relative; display: inline-block; width: 40px; height: 20px;">
                                <input type="checkbox" id="os-animation-toggle" checked style="opacity: 0; width: 0; height: 0;">
                                <span style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 20px;">
                                    <span style="position: absolute; content: ''; height: 16px; width: 16px; left: 2px; bottom: 2px; background-color: white; transition: .4s; border-radius: 50%;"></span>
                                </span>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- Synchronization section -->
                <div>
                    <h3 style="color: #00a1d6; font-family: Arial, sans-serif; font-size: 16px; margin-bottom: 10px;">Subtitle Synchronization</h3>
                    <p style="font-family: Arial, sans-serif; font-size: 14px; color: #666; margin-bottom: 10px;">
                        Adjust timing (seconds): Negative values show subtitles earlier, positive values show them later.
                    </p>

                    <!-- Sync Slider -->
                    <div style="margin-bottom: 15px;">
                        <div style="display: flex; justify-content: space-between; font-family: Arial, sans-serif; font-size: 12px; color: #666;">
                            <span>-30s</span>
                            <span>0s</span>
                            <span>+30s</span>
                        </div>
                        <input type="range" id="os-sync-slider" min="-30" max="30" step="0.1" value="0" style="width: 100%;">
                    </div>

                    <!-- Exact Sync Value -->
                    <div style="margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
                        <label for="os-sync-value" style="font-family: Arial, sans-serif; font-size: 14px;">Exact Value:</label>
                        <input type="number" id="os-sync-value" step="0.1" value="0" style="width: 80px; padding: 5px; border: 1px solid #ddd; border-radius: 4px;"> seconds
                    </div>

                    <!-- Reset Button -->
                    <button id="os-sync-reset" style="padding: 8px 15px; background-color: #f0f0f0; color: #333; border: none; border-radius: 4px; cursor: pointer; font-family: Arial, sans-serif;">
                        Reset Timing
                    </button>
                </div>
            </div>
            <div id="os-settings-footer" style="padding: 15px 20px; border-top: 1px solid #eee; background-color: #f9f9f9; text-align: right;">
                <button id="os-settings-save-btn" style="padding: 8px 15px; background-color: #00a1d6; color: white; border: none; border-radius: 4px; cursor: pointer; font-family: Arial, sans-serif;">
                    Save Settings
                </button>
            </div>
        `;

        settingsOverlay.appendChild(settingsModal);
        document.body.appendChild(settingsOverlay);
        
        document
            .getElementById("os-animation-toggle")
            .addEventListener("change", handleAnimationToggleChange);
        document
            .getElementById("os-settings-close-btn")
            .addEventListener("click", hideSettingsModal);
        document
            .getElementById("os-settings-save-btn")
            .addEventListener("click", saveSettings);
        document
            .getElementById("os-refresh-user-info")
            .addEventListener("click", refreshUserInfo);
        document
            .getElementById("os-font-size-decrease")
            .addEventListener("click", () => adjustFontSize(-1));
        document
            .getElementById("os-font-size-increase")
            .addEventListener("click", () => adjustFontSize(1));
        document.querySelectorAll(".os-font-color-btn").forEach((btn) =>
            btn.addEventListener("click", (e) => {
                setFontColor(e.target.dataset.color);
                highlightSelectedFontColor(e.target);
            })
        );
        document
            .getElementById("os-custom-font-color")
            .addEventListener("input", (e) => {
                setFontColor(e.target.value);
                clearFontColorSelection();
            });
        document
            .getElementById("os-bg-toggle")
            .addEventListener("change", handleBgToggleChange);
        document
            .getElementById("os-outline-toggle")
            .addEventListener("change", handleOutlineToggleChange);
        document.querySelectorAll(".os-outline-color-btn").forEach((btn) =>
            btn.addEventListener("click", (e) => {
                setOutlineColor(e.target.dataset.color);
                highlightSelectedOutlineColor(e.target);
            })
        );
        document
            .getElementById("os-custom-outline-color")
            .addEventListener("input", (e) => {
                setOutlineColor(e.target.value);
                clearOutlineColorSelection();
            });
        document
            .getElementById("os-hex-color-input")
            .addEventListener("input", handleFontHexColorInput);
        document
            .getElementById("os-custom-font-color")
            .addEventListener("input", handleFontColorPickerInput);
        document
            .getElementById("os-bg-opacity")
            .addEventListener("input", (e) =>
                setTextContent("os-bg-opacity-value", e.target.value)
            );
        document
            .getElementById("os-sync-slider")
            .addEventListener("input", (e) =>
                setInputVal("os-sync-value", e.target.value)
            );
        document
            .getElementById("os-sync-value")
            .addEventListener("input", handleSyncValueInput);
        document
            .getElementById("os-sync-reset")
            .addEventListener("click", resetSyncSettings);
        document.querySelectorAll(".os-bg-color-btn").forEach((btn) =>
            btn.addEventListener("click", (e) => {
                setBgColor(e.target.dataset.color);
                highlightSelectedBgColor(e.target);
                setInputVal("os-bg-hex-color-input", e.target.dataset.color);
            })
        );
        document
            .getElementById("os-custom-bg-color")
            .addEventListener("input", handleBgColorPickerInput);
        document
            .getElementById("os-bg-hex-color-input")
            .addEventListener("input", handleBgHexColorInput);
        document
            .getElementById("os-outline-hex-color-input")
            .addEventListener("input", handleOutlineHexColorInput);
        document
            .getElementById("os-custom-outline-color")
            .addEventListener("input", handleOutlineColorPickerInput);

        settingsOverlay.addEventListener("click", (e) => {
            if (e.target === settingsOverlay) hideSettingsModal();
        });
    }

    // Create results modal if it doesn't exist
    function createResultsModal() {
        // If the modal already exists, do nothing
        if (document.getElementById("opensubtitles-results-overlay")) {
            return;
        }

        // If we reach here, the modal doesn't exist yet, so create it
        console.log("Results modal not found. Creating it now...");

        const resultsOverlay = createDiv(
            "opensubtitles-results-overlay",
            "",
            `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            z-index: 10000;
            display: none;
            justify-content: center;
            align-items: center;
        `
        );

        const resultsModal = createDiv(
            "opensubtitles-results-modal",
            "",
            `
            background-color: white;
            padding: 0;
            border-radius: 6px;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
            width: 500px;
            max-width: 90%;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        `
        );

        resultsModal.innerHTML = `
            <div id="os-results-header" style="padding: 15px 20px; border-bottom: 1px solid #eee; background-color: #f9f9f9;">
                <h2 id="os-results-title" style="margin: 0; color: #00a1d6; font-family: Arial, sans-serif; font-size: 18px;">Search Results</h2>
                <div id="os-results-summary" style="margin-top: 5px; font-size: 14px; color: #666; font-family: Arial, sans-serif;"></div>
            </div>
            <div id="os-results-container" style="flex: 1; overflow-y: auto; padding: 15px 20px;"></div>
            <div id="os-results-controls" style="padding: 15px 20px; border-top: 1px solid #eee; background-color: white;">
                <div style="display: flex; justify-content: space-between; gap: 10px;">
                    <button type="button" id="os-prev-btn" style="padding: 8px 15px; background-color: #f0f0f0; color: #333; border: none; border-radius: 4px; cursor: pointer; font-family: Arial, sans-serif; flex: 1;">Previous</button>
                    <button type="button" id="os-back-search-btn" style="padding: 8px 15px; background-color: #f0f0f0; color: #333; border: none; border-radius: 4px; cursor: pointer; font-family: Arial, sans-serif; flex: 1;">Back to Search</button>
                    <button type="button" id="os-next-btn" style="padding: 8px 15px; background-color: #00a1d6; color: white; border: none; border-radius: 4px; cursor: pointer; font-family: Arial, sans-serif; flex: 1;">Next</button>
                </div>
                <div id="os-pagination-info" style="text-align: center; margin-top: 10px; font-family: Arial, sans-serif; font-size: 14px; color: #666;"></div>
            </div>
        `;
        resultsOverlay.appendChild(resultsModal);
        document.body.appendChild(resultsOverlay);

        // Add event listeners for the new modal
        document
            .getElementById("os-prev-btn")
            .addEventListener("click", () => navigateResults("prev"));
        document
            .getElementById("os-next-btn")
            .addEventListener("click", () => navigateResults("next"));
        document
            .getElementById("os-back-search-btn")
            .addEventListener("click", backToSearch);
    }
    
    function handleAnimationToggleChange(e) {
        const isChecked = e.target.checked;
        
        // Update the visual appearance of the toggle
        e.target.nextElementSibling.style.backgroundColor = isChecked 
            ? "#00a1d6" 
            : "#ccc";
        e.target.nextElementSibling.querySelector("span").style.transform = 
            isChecked ? "translateX(20px)" : "";
    }

    // --- Initialization and Startup ---

    // Update the init function to include auto user info fetch
    async function init() {
        try {
            console.log("[Subtitles Selector] init...");
            await openDatabase(); // Initialize database first
            console.log("Database opened successfully in init()"); // ADDED: Verify database open
            createUI(); // Create UI elements

            // Check for existing token before creating modals and event listeners
            const isTokenValid = await checkToken();
            const button = document.getElementById("opensubtitles-login-btn");
            console.log('[Subtitles Selector] Token validity:', isTokenValid);
            if (isTokenValid) {
                console.log('Valid token found, updating button to Subtitles mode');
                updateButtonToSubtitles();
                // Automatically fetch user info on startup if token is valid
                await handleAutoUserInfoFetch();
            } else {
                console.log('No valid token found, keeping Login button');
                if (button) {
                    button.textContent = "OpenSubtitles Login"; // Explicitly set to Login button text
                    button.style.backgroundColor = "#00a1d6"; // Reset to default Login button color if needed
                }
            }

            createSettingsModal(); // Create settings modal
            createResultsModal(); // Create results modal

            document.getElementById('os-settings-btn').addEventListener('click', showSettingsModal);

            loadSettings(); // Load user settings on startup

        } catch (error) {
            console.error("Error in initialization:", error);
        }
    }

    // Start the script after DOM is ready
    function start() {
        console.log("[Subtitles Selector] Staring OpenSubtitles script...");
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", init);
        } else {
            init();
        }
    }

    start(); // Start the script
})();