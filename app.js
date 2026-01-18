// Supabase Configuration
const SUPABASE_URL = 'https://iaamejzakzludsultmxo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_z4Or6Uoyd7OkBT9uYjALxw_0kRx-dYS';
let supabase = null;

try {
    if (window.supabase) {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
} catch (err) {
    console.error('Supabase Init Error:', err);
}

const app = {
    syncId: 'family-shared-v1', // Unique ID for your family
    state: {
        currentUser: null, // If null, show login
        view: 'calendar', // 'calendar' | 'shopping'
        members: [],
        appointments: [],
        storeTypes: [],
        groceryItems: [],
        currentWeekOffset: 0,
        selectedStoreId: null,
        settings: {
            startHour: 8,
            endHour: 20
        }
    },

    async init() {
        console.log('App Initializing...');
        // 1. Load Local Data first so we can show SOMETHING immediately
        this.loadLocalData();
        this.render();

        // 2. Setup Events
        this.setupEventListeners();

        // 3. Try Cloud Sync in the background
        this.loadCloudData().then(() => {
            console.log('Cloud sync check complete');
            this.checkAuth();
        });

        this.initRealtime();
    },

    checkAuth() {
        if (!this.state.currentUser && this.state.members.length > 0) {
            this.auth.showLogin();
        }
    },

    loadLocalData() {
        const stored = localStorage.getItem('familySyncData');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                // Merge carefully
                this.state.members = Array.isArray(parsed.members) ? parsed.members : this.state.members;
                this.state.appointments = Array.isArray(parsed.appointments) ? parsed.appointments : this.state.appointments;
                this.state.storeTypes = Array.isArray(parsed.storeTypes) ? parsed.storeTypes : this.state.storeTypes;
                this.state.groceryItems = Array.isArray(parsed.groceryItems) ? parsed.groceryItems : this.state.groceryItems;
                this.state.settings = parsed.settings || this.state.settings;
                console.log('Local Data Loaded');
            } catch (e) {
                console.error('Local JSON Error:', e);
            }
        }

        // Seed if totally empty
        if (this.state.members.length === 0) {
            this.state.members = [{ id: 'm1', name: 'Admin', color: '#002c3a', pin: '0000' }];
            this.state.storeTypes = [{ id: 's1', name: 'Groceries' }];
        }
    },

    async loadCloudData() {
        if (!supabase) return;

        try {
            const { data, error } = await supabase
                .from('sync_state')
                .select('content')
                .eq('id', this.syncId)
                .single();

            if (data && data.content) {
                console.log('Cloud Data Found, Syncing...');
                this.applySyncedData(data.content);
            } else if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
                console.warn('Cloud Sync Error (might be missing table):', error);
            }
        } catch (err) {
            console.error('Cloud Fetch Error:', err);
        }
    },

    applySyncedData(content) {
        // Only update shared properties, keep local ones (currentUser, view, etc.)
        this.state.members = content.members || [];
        this.state.appointments = content.appointments || [];
        this.state.storeTypes = content.storeTypes || [];
        this.state.groceryItems = content.groceryItems || [];
        this.state.settings = content.settings || { startHour: 8, endHour: 20 };
        this.render();
    },

    async saveData() {
        // Save to Local for redundancy
        localStorage.setItem('familySyncData', JSON.stringify({
            members: this.state.members,
            appointments: this.state.appointments,
            storeTypes: this.state.storeTypes,
            groceryItems: this.state.groceryItems,
            settings: this.state.settings
        }));

        // Push to Supabase
        if (supabase) {
            const sharedContent = {
                members: this.state.members,
                appointments: this.state.appointments,
                storeTypes: this.state.storeTypes,
                groceryItems: this.state.groceryItems,
                settings: this.state.settings
            };

            const { error } = await supabase
                .from('sync_state')
                .upsert({ id: this.syncId, content: sharedContent });

            if (error) console.error('Cloud Sync Error:', error);
        }
    },

    initRealtime() {
        if (!supabase) return;

        supabase
            .channel('schema-db-changes')
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'sync_state', filter: `id=eq.${this.syncId}` },
                (payload) => {
                    console.log('Remote update received!');
                    if (payload.new && payload.new.content) {
                        this.applySyncedData(payload.new.content);
                    }
                }
            )
            .subscribe();
    },

    switchView(viewName) {
        this.state.view = viewName;

        // Update Nav
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`nav-${viewName}`).classList.add('active');

        // Close mobile sidebar if open
        this.ui.toggleSidebar(false);

        this.render();
    },

    render() {
        // Render Sidebar
        this.renderSidebar();

        // Render Main View
        const main = document.getElementById('main-view');
        main.innerHTML = ''; // Clear

        if (this.state.view === 'calendar') {
            this.renderCalendar(main);
        } else {
            this.renderShopping(main);
        }
    },

    renderSidebar() {
        const sidebarList = document.getElementById('sidebar-list');
        const sidebarTitle = document.getElementById('sidebar-title');
        sidebarList.innerHTML = '';

        if (this.state.view === 'calendar') {
            sidebarTitle.textContent = 'Members';
            this.state.members.forEach(member => {
                const el = document.createElement('div');
                el.className = 'sidebar-item';

                // Content
                const content = document.createElement('div');
                content.style.display = 'flex';
                content.style.alignItems = 'center';
                content.style.gap = '10px';
                content.style.flex = '1';
                content.innerHTML = `
                    <div class="member-avatar" style="background: ${member.color}; color: white;">
                        ${member.name[0].toUpperCase()}
                    </div>
                    <span>${member.name}</span>
                `;

                // Delete logic (prevent deleting self if logged in, or just allow it for now)
                const delBtn = document.createElement('button');
                delBtn.className = 'icon-btn-small';
                delBtn.innerHTML = '<i class="fa-regular fa-trash-can"></i>';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    app.handlers.deleteMember(member.id);
                };

                el.appendChild(content);
                el.appendChild(delBtn);
                sidebarList.appendChild(el);
            });
        } else {
            sidebarTitle.textContent = 'Stores';
            this.state.storeTypes.forEach(store => {
                const el = document.createElement('div');
                el.className = `sidebar-item ${this.state.selectedStoreId === store.id ? 'active' : ''}`;

                // Content
                const content = document.createElement('div');
                content.style.display = 'flex';
                content.style.alignItems = 'center';
                content.style.gap = '10px';
                content.style.flex = '1';
                content.innerHTML = `
                    <i class="fa-solid fa-store"></i>
                    <span>${store.name}</span>
                `;
                content.onclick = () => {
                    this.state.selectedStoreId = store.id;
                    this.render(); // Re-render to show new list
                };

                // Delete Button
                const delBtn = document.createElement('button');
                delBtn.className = 'icon-btn-small';
                delBtn.innerHTML = '<i class="fa-regular fa-trash-can"></i>';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    app.handlers.deleteStore(store.id);
                };

                el.appendChild(content);
                el.appendChild(delBtn);
                sidebarList.appendChild(el);
            });
        }
    },

    renderCalendar(container) {
        // Controls
        const controls = document.createElement('div');
        controls.className = 'calendar-controls';

        const startOfWeek = this.getStartOfWeek(this.state.currentWeekOffset);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);

        const weekNum = this.getWeekNumber(startOfWeek);
        const dateRangeStr = `Week ${weekNum}: ${this.formatPrettyDate(startOfWeek)} - ${this.formatPrettyDate(endOfWeek)}`;

        controls.innerHTML = `
            <div style="display: flex; align-items: center; gap: 20px;">
                <div style="display: flex; gap: 5px;">
                    <button class="icon-btn" onclick="app.handlers.changeWeek(-1)"><i class="fa-solid fa-chevron-left"></i></button>
                    <button class="icon-btn" onclick="app.handlers.changeWeek(1)"><i class="fa-solid fa-chevron-right"></i></button>
                </div>
                <h3 style="font-weight: 700; font-size: 1.1rem; color: var(--text-color);">${dateRangeStr}</h3>
            </div>
            <button class="btn-primary" onclick="app.ui.openModal('appointment')">+ Appointment</button>
        `;
        container.appendChild(controls);

        // Grid
        const grid = document.createElement('div');
        grid.className = 'calendar-grid';

        // Headers
        grid.appendChild(this.createGridCell('grid-header', '')); // Top-left blank

        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        days.forEach((d, i) => {
            const dayDate = new Date(startOfWeek);
            dayDate.setDate(startOfWeek.getDate() + i);
            const isToday = dayDate.toDateString() === new Date().toDateString();

            const cell = this.createGridCell('grid-header', `
                <div style="${isToday ? 'color: var(--primary-color)' : ''}">
                    ${d}<br><small>${dayDate.getDate()}</small>
                </div>
             `);
            grid.appendChild(cell);
        });

        // Dynamic Time Logic
        const startH = parseInt(this.state.settings.startHour);
        const endH = parseInt(this.state.settings.endHour);

        for (let hour = startH; hour <= endH; hour++) {
            // Time Label
            grid.appendChild(this.createGridCell('grid-time-label', `${hour}:00`));

            // Days
            for (let d = 0; d < 7; d++) {
                const dayDate = new Date(startOfWeek);
                dayDate.setDate(startOfWeek.getDate() + d);
                dayDate.setHours(hour, 0, 0, 0);

                const cell = this.createGridCell('grid-cell', '');
                cell.dataset.date = dayDate.toISOString();
                cell.onclick = (e) => {
                    // Prevent click if clicking an appointment card
                    if (e.target.closest('.appointment-card')) return;
                    app.handlers.onCellClick(dayDate);
                };

                // Create Content Wrapper for Relative Flow
                const contentWrapper = document.createElement('div');
                contentWrapper.className = 'grid-cell-content';

                // Find appointments for this slot
                const slotAppointments = this.state.appointments.filter(appt => {
                    const apptDate = new Date(appt.date);
                    const [apptHour, apptMin] = appt.time.split(':').map(Number);

                    return apptDate.toDateString() === dayDate.toDateString() &&
                        apptHour === hour;
                });

                slotAppointments.forEach(appt => {
                    const member = this.state.members.find(m => m.id === appt.memberId);
                    const div = document.createElement('div');
                    div.className = 'appointment-card';
                    div.textContent = member ? `${member.name}: ${appt.title}` : appt.title;
                    div.style.backgroundColor = member ? member.color : '#888';
                    div.title = `${appt.time} - ${appt.title}\n${appt.comment || ''}`;

                    if (appt.comment) {
                        const icon = document.createElement('i');
                        icon.className = 'fa-solid fa-comment-dots';
                        icon.style.position = 'absolute';
                        icon.style.top = '2px';
                        icon.style.right = '4px';
                        icon.style.fontSize = '10px';
                        icon.style.opacity = '0.8';
                        div.appendChild(icon);
                    }

                    // Add click to view details
                    div.onclick = (e) => {
                        e.stopPropagation();
                        app.handlers.onAppointmentClick(appt.id);
                    };

                    contentWrapper.appendChild(div);
                });

                cell.appendChild(contentWrapper);
                grid.appendChild(cell);
            }
        }

        container.appendChild(grid);
    },

    createGridCell(className, html) {
        const div = document.createElement('div');
        div.className = className;
        div.innerHTML = html;
        return div;
    },

    renderShopping(container) {
        if (!this.state.selectedStoreId && this.state.storeTypes.length > 0) {
            this.state.selectedStoreId = this.state.storeTypes[0].id;
        }

        const currentStore = this.state.storeTypes.find(s => s.id === this.state.selectedStoreId);

        if (!currentStore) {
            container.innerHTML = `<div style="text-align:center; opacity:0.6; margin-top:50px;">Select or Create a Store Type</div>`;
            return;
        }

        const items = this.state.groceryItems.filter(i => i.storeId === currentStore.id);

        container.innerHTML = `
            <div class="shopping-header" style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 25px; border-bottom: 2px solid #f0f0f0; padding-bottom: 15px;">
                <div>
                    <h2 style="font-size: 1.8rem; font-weight: 800; color: var(--text-color); margin-bottom: 4px;">${currentStore.name} List</h2>
                    <p style="font-size: 0.85rem; color: var(--text-muted);">${items.length} items total</p>
                </div>
                <button class="btn-text" style="color: var(--danger); font-size: 0.8rem; display: flex; align-items: center; gap: 6px;" onclick="app.handlers.deleteAllChecked('${currentStore.id}')">
                    <i class="fa-regular fa-trash-can"></i> Clear Completed
                </button>
            </div>
            
            <div class="input-group" style="margin-bottom: 30px;">
                <input type="text" id="quick-add-item" placeholder="Add something to ${currentStore.name} list..." 
                    onkeydown="if(event.key === 'Enter') app.handlers.onQuickAddItem('${currentStore.id}')"
                    style="width: 100%; padding: 12px 16px; border-radius: 8px; border: 1px solid #ddd; font-size: 1rem;">
            </div>

            <div class="shopping-list" id="shopping-list-ui" style="display: flex; flex-direction: column; gap: 4px;"></div>
        `;

        const listContainer = container.querySelector('#shopping-list-ui');
        items.forEach(item => {
            const el = document.createElement('div');
            el.className = `shopping-item ${item.checked ? 'checked' : ''}`;
            el.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px; flex: 1; cursor: pointer;" onclick="app.handlers.toggleItem('${item.id}')">
                    <div class="check-circle ${item.checked ? 'checked' : ''}">
                        ${item.checked ? '<i class="fa-solid fa-check"></i>' : ''}
                    </div>
                    <span style="font-size: 1rem; color: ${item.checked ? 'var(--text-muted)' : 'var(--text-color)'}; text-decoration: ${item.checked ? 'line-through' : 'none'}">${item.text}</span>
                </div>
                <button class="icon-btn" style="color: rgba(0,0,0,0.2); transition: 0.2s;" onmouseover="this.style.color='#ff6b6b'" onmouseout="this.style.color='rgba(0,0,0,0.2)'" onclick="app.handlers.deleteItem('${item.id}')">
                    <i class="fa-regular fa-trash-can"></i>
                </button>
            `;
            listContainer.appendChild(el);
        });
    },

    getStartOfWeek(offset = 0) {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
        const monday = new Date(d.setDate(diff));
        monday.setDate(monday.getDate() + (offset * 7));
        return monday;
    },

    getWeekNumber(d) {
        d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return weekNo;
    },

    formatPrettyDate(date) {
        const day = date.getDate();
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const month = monthNames[date.getMonth()];
        const year = date.getFullYear();
        return `${day}. ${month} ${year}`;
    },

    auth: {
        showLogin() {
            document.getElementById('modal-overlay').classList.remove('hidden');
            document.getElementById('modal-login').classList.remove('hidden');

            const list = document.getElementById('login-user-list');
            list.innerHTML = '';

            app.state.members.forEach(m => {
                const el = document.createElement('div');
                el.className = 'sidebar-item';
                el.innerHTML = `
                    <div class="member-avatar" style="background: ${m.color}; color: white;">
                        ${(m.name || 'User')[0].toUpperCase()}
                    </div>
                    <span>${m.name}</span>
                    <small style="opacity:0.6; font-size:0.8em; margin-left:auto;">PIN: ${m.pin}</small>
                `;

                // Use event listener and capture phase to ensure it catches the click
                el.addEventListener('click', (e) => {
                    console.log('Login user clicked:', m.name, 'PIN:', m.pin);
                    e.preventDefault();
                    e.stopPropagation();
                    app.auth.promptPin(m);
                });

                list.appendChild(el);
            });

            // Hide pin container safely
            document.getElementById('login-pin-container').classList.add('hidden');
            document.getElementById('login-user-list').classList.remove('hidden');
        },

        promptPin(member) {
            app.auth.pendingLoginUser = member;
            document.getElementById('login-user-list').classList.add('hidden');
            document.getElementById('login-pin-container').classList.remove('hidden');
            document.getElementById('login-selected-user').textContent = `Enter PIN for ${member.name}`;
            document.getElementById('login-pin-input').value = '';
            document.getElementById('login-pin-input').focus();
        },

        resetLogin() {
            document.getElementById('login-pin-container').classList.add('hidden');
            document.getElementById('login-user-list').classList.remove('hidden');
        },

        submitPin() {
            const pin = document.getElementById('login-pin-input').value;
            const user = app.auth.pendingLoginUser;

            // Simple check (allow empty pin if none set)
            if ((!user.pin && pin === '') || user.pin === pin) {
                app.state.currentUser = user;
                document.getElementById('modal-login').classList.add('hidden');
                document.getElementById('modal-overlay').classList.add('hidden');
                app.render();
            } else {
                alert('Incorrect PIN');
            }
        },

        logout() {
            app.state.currentUser = null;
            app.auth.showLogin();
        }
    },

    data: {
        exportData() {
            const dataStr = JSON.stringify(app.state);
            navigator.clipboard.writeText(dataStr).then(() => {
                alert('Data copied to clipboard! You can send this to your family.');
            });
        },

        importData() {
            const dataStr = document.getElementById('import-area').value;
            try {
                const data = JSON.parse(dataStr);
                if (confirm('This will overwrite current data. Are you sure?')) {
                    app.state = data;
                    app.saveData();
                    app.render();
                    alert('Data imported successfully!');
                    app.ui.closeModals();
                }
            } catch (e) {
                alert('Invalid data format.');
            }
        }
    },

    handlers: {
        changeWeek(dir) {
            app.state.currentWeekOffset += dir;
            app.render();
        },

        onCellClick(dateObj) {
            const dateStr = dateObj.toISOString().split('T')[0];
            const timeStr = `${String(dateObj.getHours()).padStart(2, '0')}:00`;

            const form = document.querySelector('#form-appointment');
            form.reset();
            form.querySelector('[name=id]').value = '';
            form.querySelector('[name=date]').value = dateStr;
            form.querySelector('[name=time]').value = timeStr;

            // Hide delete btn for new
            document.getElementById('btn-delete-appt-edit').classList.add('hidden');

            app.ui.openModal('appointment');
        },

        onAddSidebarItem() {
            if (app.state.view === 'calendar') {
                app.ui.openModal('member');
            } else {
                app.ui.openModal('store');
            }
        },

        toggleItem(itemId) {
            const item = app.state.groceryItems.find(i => i.id === itemId);
            if (item) {
                item.checked = !item.checked;
                app.saveData();
                app.render();
            }
        },

        deleteItem(itemId) {
            if (confirm('Remove item?')) {
                app.state.groceryItems = app.state.groceryItems.filter(i => i.id !== itemId);
                app.saveData();
                app.render();
            }
        },

        deleteMember(memberId) {
            if (confirm('Delete this family member? Appointments will remain but lose association.')) {
                app.state.members = app.state.members.filter(m => m.id !== memberId);
                // Also remove authentication if it was the logged in user
                if (app.state.currentUser && app.state.currentUser.id === memberId) {
                    app.state.currentUser = null;
                    app.auth.showLogin();
                } else {
                    app.saveData();
                    app.render();
                }
            }
        },

        deleteStore(storeId) {
            if (confirm('Delete this store list?')) {
                app.state.storeTypes = app.state.storeTypes.filter(s => s.id !== storeId);
                if (app.state.selectedStoreId === storeId) {
                    app.state.selectedStoreId = null;
                }
                app.saveData();
                app.render();
            }
        },

        deleteAllChecked(storeId) {
            const checkedCount = app.state.groceryItems.filter(i => i.storeId === storeId && i.checked).length;
            if (checkedCount === 0) return;

            if (confirm(`Remove all ${checkedCount} completed items from this list?`)) {
                app.state.groceryItems = app.state.groceryItems.filter(i => !(i.storeId === storeId && i.checked));
                app.saveData();
                app.render();
            }
        },

        onQuickAddItem(storeId) {
            const input = document.getElementById('quick-add-item');
            const text = input.value.trim();
            if (text) {
                app.state.groceryItems.push({
                    id: 'i' + Date.now(),
                    storeId: storeId,
                    text: text,
                    checked: false
                });
                input.value = '';
                app.saveData();
                app.render();
                // Refocus after render (which rebuilds DOM)
                setTimeout(() => {
                    const newInput = document.getElementById('quick-add-item');
                    if (newInput) newInput.focus();
                }, 50);
            }
        },

        onAppointmentClick(apptId) {
            const appt = app.state.appointments.find(a => a.id === apptId);
            if (appt) {
                app.handlers.editAppointment(appt);
            }
        },
        deleteAppointment(apptId) {
            if (confirm('Delete this appointment?')) {
                app.state.appointments = app.state.appointments.filter(a => a.id !== apptId);
                app.saveData();
                app.ui.closeModals();
                app.render();
            }
        },

        editAppointment(appt) {
            const form = document.querySelector('#form-appointment');
            form.reset();
            form.querySelector('[name=id]').value = appt.id;
            form.querySelector('[name=title]').value = appt.title;
            form.querySelector('[name=date]').value = appt.date;
            form.querySelector('[name=time]').value = appt.time;
            form.querySelector('[name=comment]').value = appt.comment || '';

            // Show delete button
            const delBtn = document.getElementById('btn-delete-appt-edit');
            if (delBtn) {
                delBtn.classList.remove('hidden');
                delBtn.onclick = () => app.handlers.deleteAppointment(appt.id);
            }

            app.ui.openModal('appointment');
            // Populate select after modal open
            setTimeout(() => {
                const sel = form.querySelector('[name=memberId]');
                if (sel) sel.value = appt.memberId;
            }, 0);
        }
    },

    ui: {
        openModal(name) {
            document.getElementById('modal-overlay').classList.remove('hidden');
            // Hide all other modals first to prevent stacking
            document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));

            const modal = document.getElementById(`modal-${name}`);
            if (modal) modal.classList.remove('hidden');

            // Specific Modal Logic
            if (name === 'appointment') {
                const select = document.getElementById('appt-member-select');
                select.innerHTML = '';
                app.state.members.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.name;
                    select.appendChild(opt);
                });
            } else if (name === 'settings') {
                // Populate hours
                const createOpts = (selId, selected) => {
                    const sel = document.getElementById(selId);
                    sel.innerHTML = '';
                    for (let i = 0; i < 24; i++) {
                        const opt = document.createElement('option');
                        opt.value = i;
                        opt.textContent = `${i}:00`;
                        if (i == selected) opt.selected = true;
                        sel.appendChild(opt);
                    }
                };
                createOpts('setting-startHour', app.state.settings.startHour);
                createOpts('setting-endHour', app.state.settings.endHour);
            }
        },

        closeModals() {
            // Only block closing if the login modal is the ONLY one open and static
            const loginModal = document.getElementById('modal-login');
            if (!app.state.currentUser && !loginModal.classList.contains('hidden')) {
                // Check if any OTHER modal is open. If so, we can close it.
                const otherOpen = Array.from(document.querySelectorAll('.modal'))
                    .filter(m => m.id !== 'modal-login' && !m.classList.contains('hidden'));

                if (otherOpen.length === 0) return; // Only login is open, and we are logged out.
            }

            document.getElementById('modal-overlay').classList.add('hidden');
            document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
        },

        toggleSidebar(open) {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebar-overlay');
            if (open) {
                sidebar.classList.add('mobile-open');
                overlay.classList.add('active');
            } else {
                sidebar.classList.remove('mobile-open');
                overlay.classList.remove('active');
            }
        }
    }
};

// Event Listeners
app.setupEventListeners = function () {
    // Add Member
    document.getElementById('form-member').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        app.state.members.push({
            id: 'm' + Date.now(),
            name: fd.get('name'),
            color: fd.get('color'),
            pin: fd.get('pin')
        });
        e.target.reset();
        app.saveData();
        app.ui.closeModals();
        if (!app.state.currentUser) {
            app.auth.showLogin();
        } else {
            app.render();
        }
    });

    // Add Appointment
    document.getElementById('form-appointment').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const id = fd.get('id');

        if (id) {
            // Update existing
            const appt = app.state.appointments.find(a => a.id === id);
            if (appt) {
                appt.memberId = fd.get('memberId');
                appt.date = fd.get('date');
                appt.time = fd.get('time');
                appt.title = fd.get('title');
                appt.comment = fd.get('comment');
            }
        } else {
            // Create new
            app.state.appointments.push({
                id: 'a' + Date.now(),
                memberId: fd.get('memberId'),
                date: fd.get('date'),
                time: fd.get('time'),
                title: fd.get('title'),
                comment: fd.get('comment')
            });
        }
        e.target.reset();
        app.saveData();
        app.ui.closeModals();
        app.render();
    });

    // Add Store
    document.getElementById('form-store').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const name = fd.get('name');
        const id = 's' + Date.now();

        app.state.storeTypes.push({ id, name });
        // Select new store automatically
        app.state.selectedStoreId = id;

        e.target.reset();
        app.saveData();
        app.ui.closeModals();
        app.render();
    });

    // Add Item
    document.getElementById('form-item').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        if (!app.state.selectedStoreId) return;

        app.state.groceryItems.push({
            id: 'i' + Date.now(),
            storeId: app.state.selectedStoreId,
            text: fd.get('text'),
            checked: false
        });

        // Don't close modal immediately for rapid entry
        e.target.querySelector('input[name=text]').value = '';
        app.saveData();
        app.render();
    });

    // Settings Save
    document.getElementById('form-settings').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        app.state.settings.startHour = fd.get('startHour');
        app.state.settings.endHour = fd.get('endHour');
        app.saveData();
        app.ui.closeModals();
        app.render();
    });

    // Modal background click
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target.id === 'modal-overlay') app.ui.closeModals();
    });
};

// Start
app.init();
