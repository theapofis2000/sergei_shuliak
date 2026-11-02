(() => {
    const config = window.SUPABASE_CONFIG || {};
    const projectUrl = typeof config.url === 'string' ? config.url.trim().replace(/\/+$/, '') : '';
    const publishableKey = typeof config.publishableKey === 'string' ? config.publishableKey.trim() : '';
    const isConfigured = projectUrl.startsWith('https://') && publishableKey.length > 0;

    const rpc = async (functionName, payload) => {
        const response = await fetch(projectUrl + '/rest/v1/rpc/' + functionName, {
            method: 'POST',
            headers: {
                'apikey': publishableKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error('Supabase RPC request failed with status ' + response.status);
        }
    };

    const createDailyVisitorId = () => {
        if (!window.crypto) return '';
        if (typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
        if (typeof window.crypto.getRandomValues !== 'function') return '';

        const bytes = window.crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };

    // Один случайный ID учитывается раз в сутки; IP и контактные данные не входят в payload.
    const recordDailyUniqueVisit = () => {
        if (!isConfigured) return;

        try {
            const storageKey = 'site-visitor-daily-id';
            const today = new Date().toISOString().slice(0, 10);
            const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
            let visitorId = saved && saved.date === today ? saved.id : '';

            if (!visitorId) {
                visitorId = createDailyVisitorId();
                if (!visitorId) return;
                localStorage.setItem(storageKey, JSON.stringify({ date: today, id: visitorId }));
            }

            rpc('record_unique_site_visit', { p_visitor_id: visitorId }).catch(() => {
                // Статистика не должна мешать загрузке сайта, если база временно недоступна.
            });
        } catch (error) {
            // Если браузер запрещает localStorage, не отправляем новый ID при каждой перезагрузке.
        }
    };

    recordDailyUniqueVisit();

    const form = document.getElementById('feedbackForm');
    const status = document.getElementById('feedbackStatus');
    if (!form || !status) return;

    const submitButton = form.querySelector('button[type="submit"]');
    const setStatus = (message, state) => {
        status.textContent = message;
        status.dataset.state = state;
    };

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (!isConfigured) {
            setStatus('Форма пока не подключена к базе данных. Сообщение не отправлено.', 'error');
            return;
        }

        const values = new FormData(form);
        if (String(values.get('website') || '').trim()) {
            // Honeypot: ботам показываем успешную отправку, но запись в базу не создаём.
            form.reset();
            setStatus('Спасибо! Сообщение отправлено.', 'success');
            return;
        }

        if (submitButton) submitButton.disabled = true;
        setStatus('Отправляю сообщение…', 'pending');

        try {
            await rpc('submit_contact_message', {
                p_name: String(values.get('name') || '').trim(),
                p_email: String(values.get('email') || '').trim(),
                p_message: String(values.get('message') || '').trim()
            });
            form.reset();
            setStatus('Спасибо! Сообщение отправлено.', 'success');
        } catch (error) {
            setStatus('Не удалось отправить сообщение. Попробуйте ещё раз позже.', 'error');
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    });
})();
