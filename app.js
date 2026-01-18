// --- 1. STARTUP ---
// No production alerts

// --- 2. ERROR HANDLING ---
window.onerror = function (msg, url, line) {
    // Hidden logs for production
    console.error("Error: " + msg + " at line " + line);
    return false;
};

// --- 3. SUPABASE ---
var SUPABASE_URL = 'https://iaamejzakzludsultmxo.supabase.co';
var SUPABASE_KEY = 'sb_publishable_z4Or6Uoyd7OkBT9uYjALxw_0kRx-dYS';
var supabaseClient = null;

try {
    if (window.supabase) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
} catch (e) { console.warn("Supabase skipped"); }

// --- 4. APP LOGIC ---
var app = {
    syncId: 'family-shared-v1',
    state: {
        currentUser: null,
        view: 'calendar',
        members: [],
        appointments: [],
        storeTypes: [],
        groceryItems: [],
        currentWeekOffset: 0,
        selectedStoreId: null,
        settings: { startHour: 8, endHour: 20 }
    },

    init: function () {
        this.loadLocalData();
        this.setupEventListeners();
        this.render();

        if (!this.state.currentUser) { this.auth.showLogin(); }

        if (supabaseClient) {
            this.loadCloudData();
            this.initRealtime();
        }
    },

    loadLocalData: function () {
        var stored = localStorage.getItem('familySyncData');
        if (stored) {
            try {
                var parsed = JSON.parse(stored);
                if (parsed) {
                    this.state.members = parsed.members || [];
                    this.state.appointments = parsed.appointments || [];
                    this.state.storeTypes = parsed.storeTypes || [];
                    this.state.groceryItems = parsed.groceryItems || [];
                    this.state.settings = parsed.settings || this.state.settings;
                }
            } catch (e) { }
        }
        if (this.state.storeTypes.length === 0) {
            this.state.storeTypes = [{ id: 's1', name: 'Groceries' }];
        }
    },

    switchView: function (viewName) {
        this.state.view = viewName;
        var btns = document.querySelectorAll('.nav-btn');
        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.toggle('active', btns[i].id === 'nav-' + viewName);
        }
        this.render();
        this.ui.toggleSidebar(false);
    },

    render: function () {
        var main = document.getElementById('main-view');
        if (!main) return;
        main.innerHTML = '';
        this.renderSidebar();

        if (this.state.view === 'calendar') { this.renderCalendar(main); }
        else { this.renderShopping(main); }
    },

    renderSidebar: function () {
        var list = document.getElementById('sidebar-list');
        var title = document.getElementById('sidebar-title');
        if (!list) return;
        list.innerHTML = '';

        if (this.state.view === 'calendar') {
            title.textContent = "Members";
            for (var i = 0; i < this.state.members.length; i++) {
                (function (m) {
                    var el = document.createElement('div');
                    el.className = 'sidebar-item';
                    el.style.display = 'flex'; el.style.justifyContent = 'space-between'; el.style.alignItems = 'center';

                    var left = document.createElement('div');
                    left.style.display = 'flex'; left.style.alignItems = 'center'; left.style.gap = '8px';
                    left.innerHTML = '<div class="member-avatar" style="background:' + m.color + '">' + (m.name || 'U')[0] + '</div><span>' + m.name + '</span>';
                    left.onclick = function () { app.handlers.onEditMember(m); };

                    var del = document.createElement('button');
                    del.className = 'icon-btn-small'; del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                    del.style.opacity = '0.3';
                    del.onclick = function (e) { e.stopPropagation(); app.handlers.deleteMemberConfirm(m.id); };

                    el.appendChild(left);
                    el.appendChild(del);
                    list.appendChild(el);
                })(this.state.members[i]);
            }
        } else {
            title.textContent = "Stores";
            for (var i = 0; i < this.state.storeTypes.length; i++) {
                (function (s) {
                    var el = document.createElement('div');
                    el.className = 'sidebar-item' + (app.state.selectedStoreId === s.id ? ' active' : '');
                    el.style.display = 'flex'; el.style.justifyContent = 'space-between'; el.style.alignItems = 'center';

                    var left = document.createElement('div');
                    left.style.display = 'flex'; left.style.alignItems = 'center'; left.style.gap = '8px';
                    left.innerHTML = '<i class="fa-solid fa-store"></i><span>' + s.name + '</span>';
                    left.onclick = function () { app.state.selectedStoreId = s.id; app.render(); };

                    var del = document.createElement('button');
                    del.className = 'icon-btn-small'; del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                    del.style.opacity = '0.3';
                    del.onclick = function (e) { e.stopPropagation(); app.handlers.deleteStore(s.id); };

                    el.appendChild(left);
                    el.appendChild(del);
                    list.appendChild(el);
                })(this.state.storeTypes[i]);
            }
        }
    },

    renderCalendar: function (container) {
        var start = this.getStartOfWeek(this.state.currentWeekOffset);
        var controls = document.createElement('div');
        controls.className = 'calendar-controls';
        var dateInfo = start.getDate() + '. ' + (["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][start.getMonth()]);
        controls.innerHTML = '<div style="display:flex; gap:10px; align-items:center;">' +
            '<button class="icon-btn" onclick="app.handlers.changeWeek(-1)"><i class="fa-solid fa-chevron-left"></i></button>' +
            '<button class="icon-btn" onclick="app.handlers.changeWeek(1)"><i class="fa-solid fa-chevron-right"></i></button>' +
            '<h3>' + dateInfo + '</h3>' +
            '</div>' +
            '<button class="btn-primary" onclick="app.handlers.onAddSidebarItem()">+ Add</button>';
        container.appendChild(controls);

        var grid = document.createElement('div');
        grid.className = 'calendar-grid';
        var hTime = document.createElement('div'); hTime.className = 'grid-header'; hTime.textContent = 'Time'; grid.appendChild(hTime);
        var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        for (var i = 0; i < 7; i++) {
            var hDay = document.createElement('div'); hDay.className = 'grid-header'; hDay.textContent = days[i]; grid.appendChild(hDay);
        }

        var sH = this.state.settings.startHour || 8;
        var eH = this.state.settings.endHour || 20;

        for (var h = sH; h <= eH; h++) {
            var label = document.createElement('div'); label.className = 'grid-time-label'; label.textContent = h + ':00'; grid.appendChild(label);
            for (var d = 0; d < 7; d++) {
                (function (hour, dayIndex) {
                    var cell = document.createElement('div');
                    cell.className = 'grid-cell';
                    var cellDate = new Date(start); cellDate.setDate(start.getDate() + dayIndex);
                    cell.onclick = function () { app.handlers.onCellClick(cellDate, hour); };

                    for (var j = 0; j < app.state.appointments.length; j++) {
                        (function (appt) {
                            var ad = new Date(appt.date);
                            if (ad.toDateString() === cellDate.toDateString() && parseInt(appt.time) === hour) {
                                var m = null;
                                for (var k = 0; k < app.state.members.length; k++) { if (app.state.members[k].id === appt.memberId) m = app.state.members[k]; }
                                var card = document.createElement('div');
                                card.className = 'appointment-card';
                                card.style.background = m ? m.color : '#002c3a';
                                card.style.color = 'white';

                                var html = '<strong>' + appt.title + '</strong>';
                                if (appt.comment && appt.comment.trim()) {
                                    html += ' <i class="fa-regular fa-comment" style="font-size:0.75rem; opacity:0.8; margin-left:4px;"></i>';
                                }
                                card.innerHTML = html;

                                card.onclick = function (e) { e.stopPropagation(); app.handlers.onEditAppointment(appt); };
                                cell.appendChild(card);
                            }
                        })(app.state.appointments[j]);
                    }
                    grid.appendChild(cell);
                })(h, d);
            }
        }
        container.appendChild(grid);
    },

    renderShopping: function (container) {
        if (!this.state.selectedStoreId && this.state.storeTypes.length > 0) { this.state.selectedStoreId = this.state.storeTypes[0].id; }
        var store = null;
        for (var i = 0; i < this.state.storeTypes.length; i++) { if (this.state.storeTypes[i].id === this.state.selectedStoreId) store = this.state.storeTypes[i]; }
        if (!store) { container.innerHTML = '<div style="padding:40px; text-align:center;">Select or Create a store in the sidebar.</div>'; return; }

        var head = document.createElement('div'); head.className = 'shopping-header';
        head.innerHTML = '<div style="display:flex; justify-content:space-between; align-items:center;">' +
            '<h2>' + store.name + '</h2>' +
            '<button class="btn-text" style="color:red;" onclick="app.handlers.clearCompleted(\'' + store.id + '\')"><i class="fa-solid fa-broom"></i> Clear Completed</button>' +
            '</div>';
        container.appendChild(head);

        var inputWrap = document.createElement('div'); inputWrap.className = 'input-group';
        var input = document.createElement('input'); input.type = 'text'; input.placeholder = 'Add something...';
        input.onkeydown = function (e) { if (e.key === 'Enter') app.handlers.onQuickAddItem(store.id); };
        inputWrap.appendChild(input); container.appendChild(inputWrap);

        var list = document.createElement('div'); list.className = 'shopping-list'; container.appendChild(list);
        for (var j = 0; j < this.state.groceryItems.length; j++) {
            (function (item) {
                if (item.storeId === store.id) {
                    var el = document.createElement('div'); el.className = 'shopping-item' + (item.checked ? ' checked' : '');
                    el.innerHTML = '<div class="check-circle' + (item.checked ? ' checked' : '') + '"></div>' +
                        '<span style="flex:1; margin-left:15px; ' + (item.checked ? 'text-decoration:line-through; opacity:0.5;' : '') + '">' + item.text + '</span>';
                    el.onclick = function () { app.handlers.toggleItem(item.id); };
                    var del = document.createElement('button'); del.className = 'icon-btn'; del.innerHTML = '<i class="fa-regular fa-trash-can"></i>';
                    del.onclick = function (e) { e.stopPropagation(); app.handlers.deleteItem(item.id); };
                    el.appendChild(del); list.appendChild(el);
                }
            })(this.state.groceryItems[j]);
        }
    },

    getStartOfWeek: function (off) {
        var d = new Date(); var day = d.getDay();
        var diff = d.getDate() - day + (day === 0 ? -6 : 1);
        var mon = new Date(d.setDate(diff)); mon.setDate(mon.getDate() + (off * 7)); return mon;
    },

    saveData: function () {
        var payload = { members: this.state.members, appointments: this.state.appointments, storeTypes: this.state.storeTypes, groceryItems: this.state.groceryItems, settings: this.state.settings };
        localStorage.setItem('familySyncData', JSON.stringify(payload));
        if (supabaseClient) { supabaseClient.from('sync_state').upsert({ id: this.syncId, content: payload }).then(function () { }); }
    },

    loadCloudData: function () {
        if (!supabaseClient) return;
        supabaseClient.from('sync_state').select('content').eq('id', this.syncId).single().then(function (res) {
            if (res.data && res.data.content) {
                var c = res.data.content;
                if (c.members && c.members.length > 0) app.state.members = c.members;
                if (c.appointments) app.state.appointments = c.appointments;
                if (c.storeTypes) app.state.storeTypes = c.storeTypes;
                if (c.groceryItems) app.state.groceryItems = c.groceryItems;
                app.render();
                if (!app.state.currentUser && app.state.members.length > 0) app.auth.showLogin();
            }
        });
    },

    initRealtime: function () {
        if (!supabaseClient) return;
        supabaseClient.channel('sync').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sync_state', filter: 'id=eq.' + this.syncId }, function (p) {
            if (p.new && p.new.content) {
                var c = p.new.content;
                app.state.members = c.members || app.state.members;
                app.state.appointments = c.appointments || app.state.appointments;
                app.state.storeTypes = c.storeTypes || app.state.storeTypes;
                app.state.groceryItems = c.groceryItems || app.state.groceryItems;
                app.render();
            }
        }).subscribe();
    },

    auth: {
        showLogin: function () {
            document.getElementById('modal-overlay').classList.remove('hidden');
            var modals = document.querySelectorAll('.modal');
            for (var i = 0; i < modals.length; i++) { modals[i].classList.add('hidden'); }
            document.getElementById('modal-login').classList.remove('hidden');
            var list = document.getElementById('login-user-list'); list.innerHTML = '';
            for (var i = 0; i < app.state.members.length; i++) {
                (function (m) {
                    var el = document.createElement('div'); el.className = 'sidebar-item'; el.style.color = '#333';
                    el.innerHTML = '<div class="member-avatar" style="background:' + m.color + '">' + (m.name || 'U')[0] + '</div><span>' + m.name + '</span>';
                    el.onclick = function () { app.auth.promptPin(m); }; list.appendChild(el);
                })(app.state.members[i]);
            }
        },
        promptPin: function (m) {
            document.getElementById('login-user-list').classList.add('hidden');
            document.getElementById('login-pin-container').classList.remove('hidden');
            document.getElementById('login-selected-user').textContent = m.name;
            var input = document.getElementById('login-pin-input');
            if (input) {
                input.setAttribute('data-userid', m.id);
                input.value = '';
                input.focus();
            }
        },
        submitPin: function () {
            var input = document.getElementById('login-pin-input');
            var userId = input.getAttribute('data-userid');
            var m = null;
            for (var i = 0; i < app.state.members.length; i++) { if (app.state.members[i].id === userId) m = app.state.members[i]; }
            if (m && m.pin === input.value) { app.state.currentUser = m; app.ui.closeModals(); app.render(); }
            else { alert("Wrong PIN"); input.value = ''; }
        },
        resetLogin: function () { document.getElementById('login-pin-container').classList.add('hidden'); document.getElementById('login-user-list').classList.remove('hidden'); },
        logout: function () { app.state.currentUser = null; app.auth.showLogin(); }
    },

    handlers: {
        changeWeek: function (dir) { app.state.currentWeekOffset += dir; app.render(); },
        onAddSidebarItem: function () {
            if (app.state.view === 'calendar') {
                document.getElementById('member-modal-title').textContent = 'New Family Member';
                document.getElementById('btn-delete-member').style.display = 'none';
                var form = document.getElementById('form-member'); form.reset(); form.querySelector('[name=id]').value = '';
                app.ui.openModal('member');
            } else {
                app.ui.openModal('store');
            }
        },
        onEditMember: function (m) {
            app.ui.openModal('member');
            document.getElementById('member-modal-title').textContent = 'Edit Member';
            document.getElementById('btn-delete-member').style.display = 'block';
            var form = document.getElementById('form-member');
            form.querySelector('[name=id]').value = m.id;
            form.querySelector('[name=name]').value = m.name;
            form.querySelector('[name=color]').value = m.color;
            form.querySelector('[name=pin]').value = m.pin;
        },
        deleteMemberConfirm: function (id) {
            if (confirm('Delete this family member?')) {
                this.deleteMember(id);
            }
        },
        deleteMember: function (manualId) {
            var id = manualId || document.getElementById('form-member').querySelector('[name=id]').value;
            if (!id) return;
            var newList = [];
            for (var i = 0; i < app.state.members.length; i++) { if (app.state.members[i].id !== id) newList.push(app.state.members[i]); }
            app.state.members = newList;

            var newAppts = [];
            for (var j = 0; j < app.state.appointments.length; j++) { if (app.state.appointments[j].memberId !== id) newAppts.push(app.state.appointments[j]); }
            app.state.appointments = newAppts;

            if (app.state.currentUser && app.state.currentUser.id === id) app.state.currentUser = null;
            app.saveData(); app.ui.closeModals();
            if (!app.state.currentUser) app.auth.showLogin();
            app.render();
        },
        onCellClick: function (d, h) {
            app.ui.openModal('appointment');
            document.getElementById('btn-delete-appt').style.display = 'none';
            var form = document.getElementById('form-appointment');
            form.reset(); form.querySelector('[name=id]').value = '';

            var select = document.getElementById('appt-member-select'); select.innerHTML = '';
            for (var i = 0; i < app.state.members.length; i++) {
                var m = app.state.members[i];
                var opt = document.createElement('option'); opt.value = m.id; opt.textContent = m.name;
                if (app.state.currentUser && m.id === app.state.currentUser.id) opt.selected = true;
                select.appendChild(opt);
            }
            form.querySelector('[name=date]').value = d.toISOString().split('T')[0];
            var timeStr = (h < 10 ? '0' + h : h) + ':00'; form.querySelector('[name=time]').value = timeStr;
            form.querySelector('[name=title]').focus();
        },
        onEditAppointment: function (appt) {
            app.ui.openModal('appointment');
            document.getElementById('btn-delete-appt').style.display = 'block';
            var form = document.getElementById('form-appointment');
            form.querySelector('[name=id]').value = appt.id;
            form.querySelector('[name=title]').value = appt.title;
            form.querySelector('[name=date]').value = appt.date;
            form.querySelector('[name=time]').value = appt.time;
            form.querySelector('[name=comment]').value = appt.comment || '';

            var select = document.getElementById('appt-member-select'); select.innerHTML = '';
            for (var i = 0; i < app.state.members.length; i++) {
                var m = app.state.members[i];
                var opt = document.createElement('option'); opt.value = m.id; opt.textContent = m.name;
                if (m.id === appt.memberId) opt.selected = true;
                select.appendChild(opt);
            }
        },
        deleteAppointment: function () {
            if (!confirm('Delete this appointment?')) return;
            var id = document.getElementById('form-appointment').querySelector('[name=id]').value;
            if (!id) return;
            var newList = [];
            for (var i = 0; i < app.state.appointments.length; i++) { if (app.state.appointments[i].id !== id) newList.push(app.state.appointments[i]); }
            app.state.appointments = newList;
            app.saveData(); app.ui.closeModals(); app.render();
        },
        deleteStore: function (id) {
            if (!confirm('Delete this store?')) return;
            var newStores = [];
            for (var i = 0; i < app.state.storeTypes.length; i++) { if (app.state.storeTypes[i].id !== id) newStores.push(app.state.storeTypes[i]); }
            app.state.storeTypes = newStores;
            var newItems = [];
            for (var j = 0; j < app.state.groceryItems.length; j++) { if (app.state.groceryItems[j].storeId !== id) newItems.push(app.state.groceryItems[j]); }
            app.state.groceryItems = newItems;
            if (app.state.selectedStoreId === id) app.state.selectedStoreId = (app.state.storeTypes[0] ? app.state.storeTypes[0].id : null);
            app.saveData(); app.render();
        },
        onQuickAddItem: function (sid) {
            var input = document.querySelector('.input-group input');
            if (input && input.value.trim()) {
                app.state.groceryItems.push({ id: 'i' + Date.now(), storeId: sid, text: input.value, checked: false });
                input.value = ''; app.saveData(); app.render();
            }
        },
        toggleItem: function (id) {
            for (var i = 0; i < app.state.groceryItems.length; i++) { if (app.state.groceryItems[i].id === id) app.state.groceryItems[i].checked = !app.state.groceryItems[i].checked; }
            app.saveData(); app.render();
        },
        deleteItem: function (id) {
            var newList = []; for (var i = 0; i < app.state.groceryItems.length; i++) { if (app.state.groceryItems[i].id !== id) newList.push(app.state.groceryItems[i]); }
            app.state.groceryItems = newList; app.saveData(); app.render();
        },
        clearCompleted: function (sid) {
            var newList = []; for (var i = 0; i < app.state.groceryItems.length; i++) { if (!app.state.groceryItems[i].checked || app.state.groceryItems[i].storeId !== sid) newList.push(app.state.groceryItems[i]); }
            app.state.groceryItems = newList; app.saveData(); app.render();
        }
    },

    ui: {
        openModal: function (n) {
            document.getElementById('modal-overlay').classList.remove('hidden');
            var modals = document.querySelectorAll('.modal'); for (var i = 0; i < modals.length; i++) modals[i].classList.add('hidden');
            var target = document.getElementById('modal-' + n); if (target) target.classList.remove('hidden');
        },
        closeModals: function () {
            if (!app.state.currentUser) return;
            document.getElementById('modal-overlay').classList.add('hidden');
        },
        toggleSidebar: function (open) {
            document.getElementById('sidebar').classList.toggle('mobile-open', open);
            document.getElementById('sidebar-overlay').classList.toggle('active', open);
        }
    },

    setupEventListeners: function () {
        var formMem = document.getElementById('form-member');
        if (formMem) formMem.onsubmit = function (e) {
            e.preventDefault(); var fd = new FormData(e.target);
            var id = fd.get('id');
            var memberData = { id: id || ('m' + Date.now()), name: fd.get('name'), color: fd.get('color'), pin: fd.get('pin') };
            if (id) {
                for (var i = 0; i < app.state.members.length; i++) { if (app.state.members[i].id === id) app.state.members[i] = memberData; }
            } else {
                app.state.members.push(memberData);
            }
            app.saveData(); app.ui.closeModals(); app.render(); e.target.reset();
        };
        var formStore = document.getElementById('form-store');
        if (formStore) formStore.onsubmit = function (e) {
            e.preventDefault(); var fd = new FormData(e.target);
            var newId = 's' + Date.now();
            app.state.storeTypes.push({ id: newId, name: fd.get('name') });
            app.state.selectedStoreId = newId;
            app.saveData(); app.ui.closeModals(); app.render(); e.target.reset();
        };
        var formAppt = document.getElementById('form-appointment');
        if (formAppt) formAppt.onsubmit = function (e) {
            e.preventDefault(); var fd = new FormData(e.target);
            var id = fd.get('id');
            var apptData = { id: id || ('a' + Date.now()), title: fd.get('title'), date: fd.get('date'), time: fd.get('time'), memberId: fd.get('memberId'), comment: fd.get('comment') };
            if (id) {
                for (var i = 0; i < app.state.appointments.length; i++) { if (app.state.appointments[i].id === id) app.state.appointments[i] = apptData; }
            } else { app.state.appointments.push(apptData); }
            app.saveData(); app.ui.closeModals(); app.render(); e.target.reset();
        };
    }
};

app.init();
