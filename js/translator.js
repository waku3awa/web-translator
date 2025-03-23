class Translator {
    constructor(settings) {
        this.settings = settings;
        this.controller = null;
    }

    async fetchWebPage(url) {
        try {
            console.log('Fetching web page:', url);
            
            // Use our server-side API to fetch the page
            const apiUrl = `/api/fetch-page?url=${encodeURIComponent(url)}`;
            console.log('Using server API:', apiUrl);
            
            // Create a timeout promise
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Fetch request timed out after 60 seconds')), 60000);
            });
            
            // Create the fetch promise
            const fetchPromise = fetch(apiUrl);
            
            // Race the fetch against the timeout
            const response = await Promise.race([fetchPromise, timeoutPromise]);
            
            if (!response.ok) {
                console.error('API response not OK:', response.status, response.statusText);
                let errorMessage = `Failed to fetch page: ${response.status} ${response.statusText}`;
                
                try {
                    const errorData = await response.json();
                    if (errorData && errorData.error) {
                        errorMessage = `Failed to fetch page: ${errorData.error}`;
                    }
                } catch (e) {
                    console.error('Failed to parse error response:', e);
                }
                
                throw new Error(errorMessage);
            }
            
            console.log('API response received, parsing JSON...');
            const data = await response.json();
            console.log('Response data:', data);
            
            if (!data) {
                throw new Error('Empty response from server');
            }
            
            if (!data.html) {
                console.error('Response data does not contain html field:', data);
                throw new Error('Invalid response format from server');
            }
            
            console.log('Fetch successful, content length:', data.html.length);
            return data.html;
        } catch (error) {
            console.error('Error fetching web page:', error);
            throw new Error(`Web page fetch error: ${error.message}`);
        }
    }

    parseHTML(htmlString) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');
        return doc;
    }

    extractContent(doc) {
        // Create a deep clone of the document
        const clone = doc.cloneNode(true);
        
        // Remove script and style tags
        const scriptsAndStyles = clone.querySelectorAll('script, style');
        scriptsAndStyles.forEach(element => element.remove());
        
        // Extract text content while preserving structure
        return this.processNode(clone.body);
    }

    processNode(node) {
        const result = {
            type: node.nodeType,
            tagName: node.tagName ? node.tagName.toLowerCase() : null,
            attributes: {},
            content: '',
            children: []
        };

        // Process attributes
        if (node.attributes) {
            for (let i = 0; i < node.attributes.length; i++) {
                const attr = node.attributes[i];
                result.attributes[attr.name] = attr.value;
            }
        }

        // Process content based on node type
        if (node.nodeType === Node.TEXT_NODE) {
            result.content = node.textContent.trim();
            return result;
        }

        // Skip translation for code blocks
        if (node.tagName === 'PRE' || node.tagName === 'CODE') {
            result.doNotTranslate = true;
            result.content = node.innerHTML;
            return result;
        }

        // Process children
        for (let i = 0; i < node.childNodes.length; i++) {
            const childNode = node.childNodes[i];
            if (childNode.nodeType === Node.TEXT_NODE) {
                const text = childNode.textContent.trim();
                if (text) {
                    result.children.push({
                        type: Node.TEXT_NODE,
                        content: text
                    });
                }
            } else if (childNode.nodeType === Node.ELEMENT_NODE) {
                result.children.push(this.processNode(childNode));
            }
        }

        return result;
    }

    async translateContent(content) {
        // Prepare text for translation
        const textsToTranslate = this.extractTextsToTranslate(content);
        
        if (textsToTranslate.length === 0) {
            return content;
        }

        // Translate texts
        const translatedTexts = await this.translateTexts(textsToTranslate);
        
        // Replace original texts with translations
        return this.replaceTranslatedTexts(content, translatedTexts);
    }

    extractTextsToTranslate(node, texts = []) {
        if (node.doNotTranslate) {
            return texts;
        }

        if (node.type === Node.TEXT_NODE && node.content.trim()) {
            texts.push({
                id: texts.length,
                text: node.content
            });
            node.translationId = texts.length - 1;
        } else if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                this.extractTextsToTranslate(child, texts);
            }
        }
        
        return texts;
    }

    async translateTexts(texts) {
        console.log('Starting translation of', texts.length, 'text segments');
        const { baseUrl, modelName, apiKey } = this.settings.getSettings();
        console.log('Using API settings:', { baseUrl, modelName, apiKey: apiKey ? '***' : 'none' });
        
        // Create a new AbortController
        this.controller = new AbortController();
        const signal = this.controller.signal;

        try {
            // Prepare chunks of text to translate (to avoid too large requests)
            const chunks = this.chunkArray(texts, 10);
            console.log('Split into', chunks.length, 'chunks for translation');
            const translatedChunks = [];

            for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
                const chunk = chunks[chunkIndex];
                console.log(`Processing chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length} items`);
                
                // Check if translation has been cancelled
                if (signal.aborted) {
                    console.log('Translation aborted by user');
                    throw new Error('Translation cancelled');
                }

                const textsToTranslate = chunk.map(item => item.text).join('\n\n---\n\n');
                
                const prompt = `
                あなたは優れた翻訳者です。以下の英語のテキストを自然な日本語に翻訳してください。
                HTMLタグや特殊な記号はそのまま残してください。
                コードブロックの内容は翻訳せず、そのまま出力してください。
                各テキストは "---" で区切られています。同じ区切り記号を使って翻訳結果を返してください。

                ${textsToTranslate}
                `;

                console.log(`Sending API request to ${baseUrl}/chat/completions`);
                console.log('Request payload:', {
                    model: modelName,
                    messages: [
                        { role: 'system', content: 'You are a professional translator that translates English to Japanese.' },
                        { role: 'user', content: prompt.length > 100 ? prompt.substring(0, 100) + '...' : prompt }
                    ],
                    temperature: 0.3
                });

                try {
                    // Create a timeout promise
                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('API request timed out after 30 seconds')), 30000);
                    });
                    
                    // Create the fetch promise
                    const fetchPromise = fetch(`${baseUrl}/chat/completions`, {
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
                        signal: signal
                    });
                    
                    // Race the fetch against the timeout
                    const response = await Promise.race([fetchPromise, timeoutPromise]);

                    console.log('API response status:', response.status, response.statusText);
                    
                    if (!response.ok) {
                        let errorMessage = `API error: ${response.status} ${response.statusText}`;
                        try {
                            const errorData = await response.json();
                            console.error('API error details:', errorData);
                            errorMessage = `API error: ${errorData.error?.message || response.statusText}`;
                        } catch (e) {
                            console.error('Failed to parse error response:', e);
                        }
                        throw new Error(errorMessage);
                    }

                    const data = await response.json();
                    console.log('API response data:', data);
                    
                    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                        console.error('Unexpected API response format:', data);
                        throw new Error('Unexpected API response format');
                    }
                    
                    const translatedText = data.choices[0].message.content;
                    console.log('Received translated text, length:', translatedText.length);
                    
                    // Split the translated text by the separator
                    const translatedParts = translatedText.split('---').map(part => part.trim());
                    console.log(`Split into ${translatedParts.length} parts (expected ${chunk.length})`);
                    
                    // Map translations back to their original texts
                    for (let i = 0; i < chunk.length && i < translatedParts.length; i++) {
                        translatedChunks.push({
                            id: chunk[i].id,
                            original: chunk[i].text,
                            translated: translatedParts[i]
                        });
                    }
                } catch (error) {
                    console.error(`Error in chunk ${chunkIndex + 1}:`, error);
                    throw error;
                }
            }

            console.log('Translation completed successfully');
            // Sort by original ID to maintain order
            return translatedChunks.sort((a, b) => a.id - b.id);
        } catch (error) {
            if (error.name === 'AbortError' || error.message === 'Translation cancelled') {
                console.log('Translation was cancelled');
                throw new Error('Translation cancelled');
            } else {
                console.error('Translation error:', error);
                throw new Error(`Translation error: ${error.message}`);
            }
        }
    }

    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    replaceTranslatedTexts(node, translations) {
        if (node.doNotTranslate) {
            return node;
        }

        if (node.type === Node.TEXT_NODE && node.translationId !== undefined) {
            const translation = translations.find(t => t.id === node.translationId);
            if (translation) {
                node.content = translation.translated;
            }
        } else if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                this.replaceTranslatedTexts(child, translations);
            }
        }
        
        return node;
    }

    renderContent(content, container) {
        container.innerHTML = '';
        this.renderNode(content, container);
    }

    renderNode(node, container) {
        if (node.doNotTranslate) {
            const element = document.createElement(node.tagName || 'div');
            // Copy attributes
            for (const [key, value] of Object.entries(node.attributes)) {
                element.setAttribute(key, value);
            }
            element.innerHTML = node.content;
            container.appendChild(element);
            return;
        }

        if (node.type === Node.TEXT_NODE) {
            const textNode = document.createTextNode(node.content);
            container.appendChild(textNode);
            return;
        }

        if (node.tagName) {
            // Skip certain tags
            if (['script', 'style', 'meta', 'link'].includes(node.tagName)) {
                return;
            }

            // Create element
            const element = document.createElement(node.tagName);
            
            // Copy attributes
            for (const [key, value] of Object.entries(node.attributes)) {
                // Handle image sources
                if (key === 'src' && node.tagName === 'img' && !value.startsWith('http')) {
                    // Try to convert relative URLs to absolute
                    if (value.startsWith('/')) {
                        // Absolute path from domain root
                        const urlObj = new URL(this.currentUrl);
                        element.setAttribute(key, `${urlObj.origin}${value}`);
                    } else {
                        // Relative path
                        element.setAttribute(key, value);
                    }
                } else {
                    element.setAttribute(key, value);
                }
            }
            
            // Process children
            if (node.children && node.children.length > 0) {
                for (const child of node.children) {
                    this.renderNode(child, element);
                }
            }
            
            container.appendChild(element);
        }
    }

    cancelTranslation() {
        if (this.controller) {
            this.controller.abort();
            this.controller = null;
        }
    }
}