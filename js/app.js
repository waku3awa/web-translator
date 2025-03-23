document.addEventListener('DOMContentLoaded', () => {
    // Initialize settings
    const settings = new Settings();
    
    // DOM elements
    const urlInput = document.getElementById('urlInput');
    const translateBtn = document.getElementById('translateBtn');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const resultContainer = document.getElementById('resultContainer');
    const originalContent = document.getElementById('originalContent');
    const translatedContent = document.getElementById('translatedContent');
    const cancelBtn = document.getElementById('cancelBtn');
    const tabBtns = document.querySelectorAll('.tab-btn');
    
    // Controller for fetch cancellation
    let controller = null;
    
    // Tab switching
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all tabs
            tabBtns.forEach(tab => tab.classList.remove('active'));
            
            // Add active class to clicked tab
            btn.classList.add('active');
            
            // Hide all tab content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.add('hidden');
            });
            
            // Show selected tab content
            const tabId = btn.getAttribute('data-tab');
            document.getElementById(tabId).classList.remove('hidden');
        });
    });
    
    // Translation process
    translateBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        
        if (!url) {
            alert('URLを入力してください');
            return;
        }
        
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            alert('有効なURLを入力してください (http:// または https:// で始まる必要があります)');
            return;
        }
        
        // Show loading indicator
        loadingIndicator.classList.remove('hidden');
        resultContainer.classList.add('hidden');
        
        try {
            // Step 1: Fetch web page
            console.log('Step 1: Fetching web page...');
            const htmlContent = await fetchWebPage(url);
            console.log('Web page fetched successfully, length:', htmlContent.length);
            
            // Step 2: Parse HTML
            console.log('Step 2: Parsing HTML...');
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, 'text/html');
            
            // Step 3: Display original content
            console.log('Step 3: Displaying original content...');
            originalContent.innerHTML = '';
            const contentClone = doc.body.cloneNode(true);
            originalContent.appendChild(contentClone);
            
            // Step 4: Extract text for translation
            console.log('Step 4: Extracting text for translation...');
            const textNodes = [];
            extractTextNodes(doc.body, textNodes);
            
            if (textNodes.length === 0) {
                throw new Error('翻訳するテキストが見つかりませんでした');
            }
            
            console.log(`Found ${textNodes.length} text nodes to translate`);
            
            // Step 5: Translate text
            console.log('Step 5: Translating text...');
            const translatedNodes = await translateTextNodes(textNodes);
            
            // Step 6: Create translated document
            console.log('Step 6: Creating translated document...');
            const translatedDoc = doc.cloneNode(true);
            
            // Map translated nodes to the cloned document
            for (const item of translatedNodes) {
                const xpath = getXPath(item.node);
                const translatedNode = getElementByXPath(xpath, translatedDoc);
                
                if (translatedNode) {
                    translatedNode.textContent = item.translated;
                }
            }
            
            // Step 7: Display translated content
            console.log('Step 7: Displaying translated content...');
            translatedContent.innerHTML = '';
            translatedContent.appendChild(translatedDoc.body.cloneNode(true));
            
            // Hide loading indicator and show result
            loadingIndicator.classList.add('hidden');
            resultContainer.classList.remove('hidden');
            
            // Activate translated content tab
            tabBtns.forEach(tab => tab.classList.remove('active'));
            document.querySelector('[data-tab="translatedContent"]').classList.add('active');
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.add('hidden');
            });
            translatedContent.classList.remove('hidden');
            
        } catch (error) {
            console.error('Error in translation process:', error);
            loadingIndicator.classList.add('hidden');
            
            if (error.message === 'Translation cancelled') {
                alert('翻訳がキャンセルされました');
            } else if (error.message.includes('API error')) {
                alert(`API接続エラー: ${error.message}\n\n設定画面でAPI情報が正しいか確認してください。`);
            } else {
                alert(`エラーが発生しました: ${error.message}`);
            }
        }
    });
    
    // Cancel translation
    cancelBtn.addEventListener('click', () => {
        if (controller) {
            controller.abort();
            controller = null;
        }
    });
    
    // Function to fetch web page
    async function fetchWebPage(url) {
        console.log('Fetching web page:', url);
        
        // Create a new AbortController
        controller = new AbortController();
        const signal = controller.signal;
        
        try {
            // Fetch the web page through our server API
            const apiUrl = `/api/fetch-page?url=${encodeURIComponent(url)}`;
            console.log('Using API URL:', apiUrl);
            
            const response = await fetch(apiUrl, { 
                signal,
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`サーバーエラー: ${response.status} ${response.statusText}`);
            }
            
            const responseText = await response.text();
            
            try {
                const data = JSON.parse(responseText);
                
                if (!data.html) {
                    throw new Error('サーバーからの応答にHTMLコンテンツが含まれていません');
                }
                
                return data.html;
            } catch (jsonError) {
                console.error('JSON parse error:', jsonError);
                throw new Error('サーバーからの応答を解析できませんでした');
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Translation cancelled');
            }
            throw error;
        }
    }
    
    // Function to translate text nodes
    async function translateTextNodes(textNodes) {
        // Get API settings
        const { baseUrl, modelName, apiKey } = settings.getSettings();
        
        // Create chunks of text to translate (max 10 items per chunk)
        const chunks = [];
        for (let i = 0; i < textNodes.length; i += 10) {
            chunks.push(textNodes.slice(i, i + 10));
        }
        
        console.log(`Split into ${chunks.length} chunks for translation`);
        
        const translatedNodes = [];
        
        for (let i = 0; i < chunks.length; i++) {
            if (controller && controller.signal.aborted) {
                throw new Error('Translation cancelled');
            }
            
            const chunk = chunks[i];
            console.log(`Translating chunk ${i+1}/${chunks.length}...`);
            
            // Prepare text for translation
            const textsToTranslate = chunk.map(node => node.textContent.trim()).join('\n\n---\n\n');
            
            const prompt = `
            あなたは優れた翻訳者です。以下の英語のテキストを自然な日本語に翻訳してください。
            HTMLタグや特殊な記号はそのまま残してください。
            コードブロックの内容は翻訳せず、そのまま出力してください。
            各テキストは "---" で区切られています。同じ区切り記号を使って翻訳結果を返してください。

            ${textsToTranslate}
            `;
            
            try {
                const translationResponse = await fetch(`${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: modelName,
                        messages: [
                            {
                                role: 'system',
                                content: 'You are a professional translator that translates English to Japanese.'
                            },
                            {
                                role: 'user',
                                content: prompt
                            }
                        ],
                        temperature: 0.3
                    }),
                    signal: controller ? controller.signal : null
                });
                
                if (!translationResponse.ok) {
                    const errorText = await translationResponse.text();
                    let errorMessage = `API error: ${translationResponse.status} ${translationResponse.statusText}`;
                    
                    try {
                        const errorData = JSON.parse(errorText);
                        if (errorData.error) {
                            errorMessage = `API error: ${errorData.error.message || errorData.error}`;
                        }
                    } catch (e) {
                        // Ignore JSON parse error for error response
                    }
                    
                    throw new Error(errorMessage);
                }
                
                const translationData = await translationResponse.json();
                const translatedText = translationData.choices[0].message.content;
                
                // Split the translated text by the separator
                const translatedParts = translatedText.split('---').map(part => part.trim());
                
                // Map translations back to their nodes
                for (let j = 0; j < chunk.length && j < translatedParts.length; j++) {
                    translatedNodes.push({
                        node: chunk[j],
                        original: chunk[j].textContent,
                        translated: translatedParts[j]
                    });
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    throw new Error('Translation cancelled');
                }
                throw error;
            }
        }
        
        return translatedNodes;
    }
    
    // Helper function to extract text nodes
    function extractTextNodes(element, result) {
        if (!element) return;
        
        // Skip script and style elements
        if (element.tagName === 'SCRIPT' || element.tagName === 'STYLE') {
            return;
        }
        
        // Skip code blocks
        if (element.tagName === 'PRE' || element.tagName === 'CODE') {
            return;
        }
        
        // Process child nodes
        for (const child of element.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent.trim();
                if (text) {
                    result.push(child);
                }
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                extractTextNodes(child, result);
            }
        }
    }
    
    // Helper function to get XPath of a node
    function getXPath(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return getXPath(node.parentNode) + '/text()[' + getTextNodeIndex(node) + ']';
        }
        
        if (node === document.body) {
            return '/html/body';
        }
        
        let count = 1;
        let sibling = node.previousSibling;
        
        while (sibling) {
            if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === node.tagName) {
                count++;
            }
            sibling = sibling.previousSibling;
        }
        
        return getXPath(node.parentNode) + '/' + node.tagName.toLowerCase() + '[' + count + ']';
    }
    
    // Helper function to get text node index
    function getTextNodeIndex(textNode) {
        let count = 1;
        let sibling = textNode.previousSibling;
        
        while (sibling) {
            if (sibling.nodeType === Node.TEXT_NODE) {
                count++;
            }
            sibling = sibling.previousSibling;
        }
        
        return count;
    }
    
    // Helper function to get element by XPath
    function getElementByXPath(xpath, doc) {
        const result = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return result.singleNodeValue;
    }
});