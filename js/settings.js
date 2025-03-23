class Settings {
    constructor() {
        this.defaultSettings = {
            baseUrl: 'http://host.docker.internal:1234/v1',
            modelName: 'light-r1-32b',
            apiKey: 'lm-studio'
        };
        
        this.settings = this.loadSettings();
        this.initSettingsModal();
    }

    loadSettings() {
        const savedSettings = localStorage.getItem('translatorSettings');
        return savedSettings ? JSON.parse(savedSettings) : this.defaultSettings;
    }

    saveSettings(settings) {
        this.settings = settings;
        localStorage.setItem('translatorSettings', JSON.stringify(settings));
    }

    getSettings() {
        return this.settings;
    }

    initSettingsModal() {
        const settingsIcon = document.getElementById('settingsIcon');
        const settingsModal = document.getElementById('settingsModal');
        const closeBtn = document.querySelector('.close-btn');
        const saveBtn = document.getElementById('saveSettings');
        
        // Populate input fields with current settings
        const updateInputFields = () => {
            document.getElementById('baseUrl').value = this.settings.baseUrl;
            document.getElementById('modelName').value = this.settings.modelName;
            document.getElementById('apiKey').value = this.settings.apiKey;
        };
        
        updateInputFields();

        // Open modal
        settingsIcon.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            updateInputFields(); // Update fields with current settings
            settingsModal.classList.remove('hidden');
        });

        // Close modal
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            settingsModal.classList.add('hidden');
        });

        // Close modal when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.classList.add('hidden');
            }
        });

        // Save settings
        saveBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const newSettings = {
                baseUrl: document.getElementById('baseUrl').value,
                modelName: document.getElementById('modelName').value,
                apiKey: document.getElementById('apiKey').value
            };
            
            this.saveSettings(newSettings);
            settingsModal.classList.add('hidden');
            alert('設定が保存されました');
        });
    }
}