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

    // Записываем один просмотр за каждую загрузку страницы. В таблицу не передаются IP и cookies.
    if (isConfigured) {
        rpc('record_site_visit', {}).catch(() => {
            // Счётчик не должен мешать загрузке сайта, если база временно недоступна.
        });
    }

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
