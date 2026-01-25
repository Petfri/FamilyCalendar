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
        selectedMemberId: null,
        selectedHeaderId: null,
        settings: { startHour: 8, endHour: 20 }
    },

    init: function () {
        this.loadLocalData();
        this.setupEventListeners();
        this.render();

        if (!this.state.currentUser) { this.auth.showLogin(); }
        else { this.state.selectedMemberId = this.state.currentUser.id; }

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
                    el.className = 'sidebar-item' + (app.state.selectedMemberId === m.id ? ' active' : '');
                    el.setAttribute('data-id', m.id);
                    el.style.display = 'flex'; el.style.justifyContent = 'space-between'; el.style.alignItems = 'center';

                    var left = document.createElement('div');
                    left.style.display = 'flex'; left.style.alignItems = 'center'; left.style.gap = '8px'; left.style.flex = '1';
                    left.innerHTML = '<div class="member-avatar" style="background:' + m.color + '">' + (m.name || 'U')[0] + '</div><span>' + m.name + '</span>';
                    left.onclick = function () {
                        app.state.selectedMemberId = m.id;
                        app.render();
                    };

                    var settingsBtn = document.createElement('button');
                    settingsBtn.className = 'delete-btn-ghost';
                    settingsBtn.innerHTML = '<i class="fa-solid fa-gear"></i>';
                    settingsBtn.style.opacity = '0.4';
                    settingsBtn.onclick = function (e) {
                        e.stopPropagation();
                        app.handlers.onEditMember(m);
                    };

                    el.appendChild(left);
                    el.appendChild(settingsBtn);
                    list.appendChild(el);
                })(this.state.members[i]);
            }
        } else {
            title.textContent = "Lists";
            for (var i = 0; i < this.state.storeTypes.length; i++) {
                (function (s, idx) {
                    var el = document.createElement('div');
                    el.className = 'sidebar-item' + (app.state.selectedStoreId === s.id ? ' active' : '');
                    el.setAttribute('data-id', s.id);
                    el.style.display = 'flex'; el.style.justifyContent = 'space-between'; el.style.alignItems = 'center';

                    var left = document.createElement('div');
                    left.style.display = 'flex'; left.style.alignItems = 'center'; left.style.gap = '8px'; left.style.flex = '1';
                    left.innerHTML = '<i class="fa-solid fa-list"></i><span>' + s.name + '</span>';
                    left.onclick = function () { app.state.selectedStoreId = s.id; app.render(); };

                    var right = document.createElement('div');
                    right.style.display = 'flex'; right.style.alignItems = 'center';

                    var del = document.createElement('button');
                    del.className = 'delete-btn-ghost'; del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                    del.onclick = function (e) { e.stopPropagation(); app.handlers.deleteStore(s.id); };

                    right.appendChild(del);
                    el.appendChild(left);
                    el.appendChild(right);
                    list.appendChild(el);
                })(this.state.storeTypes[i], i);
            }
        }

        // Initialize Sortable for Sidebar
        if (window.Sortable) {
            if (list._sortable) list._sortable.destroy();
            list._sortable = new Sortable(list, {
                animation: 150,
                ghostClass: 'sortable-ghost',
                draggable: '.sidebar-item',
                onEnd: function () {
                    var newOrderIds = Array.prototype.slice.call(list.children).map(function (el) { return el.getAttribute('data-id'); });
                    if (app.state.view === 'calendar') {
                        // Reorder members
                        var newMembers = newOrderIds.map(function (id) {
                            return app.state.members.find(function (m) { return m.id === id; });
                        }).filter(Boolean);
                        app.state.members = newMembers;
                    } else {
                        // Reorder stores
                        var newStores = newOrderIds.map(function (id) {
                            return app.state.storeTypes.find(function (s) { return s.id === id; });
                        }).filter(Boolean);
                        app.state.storeTypes = newStores;
                    }
                    app.saveData();
                }
            });
        }
    },

    renderCalendar: function (container) {
        var start = this.getStartOfWeek(this.state.currentWeekOffset);
        var controls = document.createElement('div');
        controls.className = 'calendar-controls';
        var weekNum = this.getWeekNumber(start);
        var dateInfo = start.getDate() + ' ' + (["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][start.getMonth()]);
        controls.innerHTML = '<div style="display:flex; gap:12px; align-items:center; flex:1; overflow:hidden;">' +
            '<button class="week-nav-btn" onclick="app.handlers.gotoToday()" title="Today" style="border-radius:50%; min-width:36px;"><i class="fa-solid fa-calendar-day"></i></button>' +
            '<div style="display:flex; flex-direction:column; align-items:flex-start; min-width:70px;">' +
            '<small style="font-size:0.65rem; font-weight:800; opacity:0.6; text-transform:uppercase; letter-spacing:1px; color:var(--primary);">Week ' + weekNum + '</small>' +
            '<h3 style="margin:0; line-height:1.2; font-size:1.1rem; letter-spacing:-0.5px;">' + dateInfo + '</h3>' +
            '</div>' +
            '<div style="display:flex; align-items:center; gap:8px; flex:1; justify-content:center;">' +
            '<button class="week-nav-btn" onclick="app.handlers.changeWeek(-4)"><i class="fa-solid fa-angles-left"></i></button>' +
            '<div id="header-week-selector" class="week-selector-container" style="flex:1; max-width:400px; padding: 0 10px;"></div>' +
            '<button class="week-nav-btn" onclick="app.handlers.changeWeek(4)"><i class="fa-solid fa-angles-right"></i></button>' +
            '</div>' +
            '</div>';
        container.appendChild(controls);

        var weekCont = controls.querySelector('#header-week-selector');
        // Show 4 weeks around current offset
        var startOff = Math.floor(app.state.currentWeekOffset / 4) * 4;
        for (var w = startOff; w < startOff + 4; w++) {
            (function (off) {
                var d = app.getStartOfWeek(off);
                var endD = new Date(d); endD.setDate(d.getDate() + 6);
                var num = app.getWeekNumber(d);
                var monthLabel = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
                var dateRange = d.getDate() + '-' + endD.getDate();

                var pill = document.createElement('div');
                var isCurrent = (off === 0);
                pill.className = 'week-pill' + (app.state.currentWeekOffset === off ? ' active' : '') + (isCurrent ? ' current-real-week' : '');

                pill.innerHTML =
                    '<div style="font-size:0.55rem; opacity:0.8; line-height:1; margin-bottom:1px;">' + monthLabel + '</div>' +
                    '<div style="font-size:0.8rem; font-weight:900; line-height:1;">W' + num + '</div>' +
                    '<div style="font-size:0.55rem; opacity:0.8; line-height:1; margin-top:1px;">' + dateRange + '</div>';

                pill.onclick = function () { app.state.currentWeekOffset = off; app.render(); };
                weekCont.appendChild(pill);
            })(w);
        }

        var grid = document.createElement('div');
        grid.className = 'calendar-grid';
        var hTime = document.createElement('div'); hTime.className = 'grid-header'; hTime.textContent = 'TIME'; grid.appendChild(hTime);
        var days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
        for (var i = 0; i < 7; i++) {
            var hDay = document.createElement('div'); hDay.className = 'grid-header'; hDay.textContent = days[i]; grid.appendChild(hDay);
        }

        var sH = this.state.settings.startHour || 8;
        var eH = this.state.settings.endHour || 20;

        // Check for early/late appointments in current week
        var hasEarly = false;
        var hasLate = false;
        for (var k = 0; k < app.state.appointments.length; k++) {
            var apt = app.state.appointments[k];
            var ad = new Date(apt.date);
            var isInWeek = false;
            for (var dI = 0; dI < 7; dI++) {
                var wd = new Date(start); wd.setDate(start.getDate() + dI);
                if (ad.toDateString() === wd.toDateString()) { isInWeek = true; break; }
            }
            if (isInWeek) {
                var h = parseInt(apt.time);
                if (h < sH) hasEarly = true;
                if (h > eH) hasLate = true;
            }
        }

        var hours = [];
        if (hasEarly) hours.push({ val: -1, label: 'Early' });
        for (var h = sH; h <= eH; h++) hours.push({ val: h, label: h + ':00' });
        if (hasLate) hours.push({ val: 24, label: 'Late' });

        for (var iH = 0; iH < hours.length; iH++) {
            var hourObj = hours[iH];
            var label = document.createElement('div');
            label.className = 'grid-time-label' + (hourObj.val % 2 === 0 ? ' row-even' : '');
            if (hourObj.val === -1 || hourObj.val === 24) label.style.fontSize = '0.65rem';
            label.textContent = hourObj.label;
            grid.appendChild(label);

            for (var d = 0; d < 7; d++) {
                (function (hObj, dayIndex) {
                    var cell = document.createElement('div');
                    cell.className = 'grid-cell' + (hObj.val % 2 === 0 ? ' row-even' : '');
                    var cellDate = new Date(start); cellDate.setDate(start.getDate() + dayIndex);

                    if (hObj.val >= 0 && hObj.val <= 23) {
                        cell.onclick = function () { app.handlers.onCellClick(cellDate, hObj.val); };
                    }

                    var hasAppt = false;
                    for (var j = 0; j < app.state.appointments.length; j++) {
                        (function (appt) {
                            var ad = new Date(appt.date);
                            var ah = parseInt(appt.time);
                            var match = false;
                            if (ad.toDateString() === cellDate.toDateString()) {
                                if (hObj.val === -1 && ah < sH) match = true;
                                else if (hObj.val === 24 && ah > eH) match = true;
                                else if (ah === hObj.val) match = true;
                            }

                            if (match) {
                                hasAppt = true;
                                var m = null;
                                for (var k = 0; k < app.state.members.length; k++) { if (app.state.members[k].id === appt.memberId) m = app.state.members[k]; }
                                var card = document.createElement('div');
                                card.className = 'appointment-card';
                                card.style.background = m ? m.color : '#002c3a';
                                card.style.color = 'white';

                                var t = appt.time;
                                if (t && t.indexOf('0') === 0) t = t.substring(1);
                                var html = '<div style="display:flex; flex-direction:column; flex:1; overflow:hidden;">' +
                                    '<small style="font-size:0.55rem; opacity:0.8; font-weight:700; line-height:1;">' + t + '</small>' +
                                    '<span style="font-size:0.7rem; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + appt.title + '</span>' +
                                    '</div>';
                                if (appt.comment && appt.comment.trim()) {
                                    html += '<span style="font-weight:900; font-size:0.7rem; margin-left:4px;">N</span>';
                                }
                                card.innerHTML = html;
                                card.onclick = function (e) { e.stopPropagation(); app.handlers.onEditAppointment(appt); };
                                cell.appendChild(card);
                            }
                        })(app.state.appointments[j]);
                    }
                    if (hasAppt && hObj.val !== -1 && hObj.val !== 24) {
                        var quickAdd = document.createElement('div');
                        quickAdd.style.textAlign = 'center'; quickAdd.style.opacity = '0.15';
                        quickAdd.style.fontSize = '0.75rem'; quickAdd.style.marginTop = 'auto';
                        quickAdd.innerHTML = '<i class="fa-solid fa-plus"></i>';
                        cell.appendChild(quickAdd);
                    }
                    grid.appendChild(cell);
                })(hourObj, d);
            }
        }
        container.appendChild(grid);
    },

    renderShopping: function (container) {
        if (!this.state.selectedStoreId && this.state.storeTypes.length > 0) { this.state.selectedStoreId = this.state.storeTypes[0].id; }
        var store = null;
        for (var i = 0; i < this.state.storeTypes.length; i++) { if (this.state.storeTypes[i].id === this.state.selectedStoreId) store = this.state.storeTypes[i]; }
        if (!store) { container.innerHTML = '<div style="padding:40px; text-align:center;">Select or Create a list in the sidebar.</div>'; return; }

        container.innerHTML = '';
        var head = document.createElement('div'); head.className = 'shopping-header';
        head.style.display = 'flex'; head.style.justifyContent = 'space-between'; head.style.alignItems = 'center';
        head.innerHTML = '<h2>' + store.name + '</h2>';

        var optBtn = document.createElement('button');
        optBtn.className = 'btn-icon-round';
        optBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
        optBtn.onclick = function (e) { app.handlers.showShoppingMenu(e, store.id, null); };
        head.appendChild(optBtn);

        container.appendChild(head);

        var inputWrap = document.createElement('div');
        inputWrap.className = 'input-group';
        inputWrap.style.display = 'flex';
        inputWrap.style.gap = '8px';
        inputWrap.style.alignItems = 'center';

        // Input field
        var input = document.createElement('input');
        input.id = 'shopping-input';
        input.type = 'text';
        input.placeholder = 'Add something...';
        input.style.flex = '1';
        input.onkeydown = function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                app.handlers.onQuickAddItem(store.id);
            }
        };
        inputWrap.appendChild(input);

        // Heading button (at the end)
        var headingBtn = document.createElement('button');
        headingBtn.className = 'icon-btn-primary';
        headingBtn.style.minHeight = '48px';
        headingBtn.style.minWidth = '48px';
        headingBtn.style.borderRadius = '14px';
        headingBtn.style.boxShadow = '0 4px 12px rgba(0,44,58,0.3)';
        headingBtn.title = 'Add Heading';
        headingBtn.innerHTML = '<strong style="font-size: 1.1rem;">H</strong>';
        headingBtn.onclick = function () { app.handlers.addHeading(); };
        inputWrap.appendChild(headingBtn);

        container.appendChild(inputWrap);

        var list = document.createElement('div');
        list.id = 'shopping-list-items';
        list.className = 'shopping-list';
        container.appendChild(list);

        // Render items after input
        this.renderShoppingListItems();
    },

    renderShoppingListItems: function () {
        var list = document.getElementById('shopping-list-items');
        if (!list) return;
        list.innerHTML = '';
        var sid = this.state.selectedStoreId;

        // Get and group items
        var storeItems = this.state.groceryItems.filter(function (i) { return i.storeId === sid; });
        var grouped = [];
        var currentGroup = { header: null, items: [] };

        for (var k = 0; k < storeItems.length; k++) {
            var item = storeItems[k];
            if (item.isHeader) {
                if (currentGroup.header || currentGroup.items.length > 0) grouped.push(currentGroup);
                currentGroup = { header: item, items: [] };
            } else {
                currentGroup.items.push(item);
            }
        }
        grouped.push(currentGroup);

        for (var i = 0; i < grouped.length; i++) {
            var g = grouped[i];
            if (g.header) renderRow(g.header);

            // Sort items: unchecked first
            var sorted = g.items.slice().sort(function (a, b) {
                return (a.checked === b.checked) ? 0 : (a.checked ? 1 : -1);
            });

            for (var j = 0; j < sorted.length; j++) renderRow(sorted[j]);
        }

        function renderRow(item) {
            var el = document.createElement('div');
            el.className = 'shopping-item' + (item.checked ? ' checked' : '') + (item.isHeader ? ' is-header' : '') + ' interactive-item';
            if (item.isHeader && app.state.selectedHeaderId === item.id) el.classList.add('header-selected');
            el.setAttribute('data-id', item.id);

            if (item.isHeader) {
                el.innerHTML = '<span style="flex:1; margin-left:0; font-weight:800;">' + item.text + '</span>';
                var hOpt = document.createElement('button');
                hOpt.className = 'delete-btn-blue';
                hOpt.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
                hOpt.onclick = function (e) { e.stopPropagation(); app.handlers.showShoppingMenu(e, sid, item.id); };
                el.appendChild(hOpt);
            } else {
                var check = '<div class="check-circle' + (item.checked ? ' checked' : '') + '"></div>';
                el.innerHTML = check + '<span style="flex:1; margin-left:15px; ' + (item.checked ? 'text-decoration:line-through; opacity:0.5;' : '') + '">' + item.text + '</span>';
            }

            el.onclick = function (e) {
                if (e.target.closest('button')) return;
                if (item.isHeader) {
                    app.state.selectedHeaderId = (app.state.selectedHeaderId === item.id) ? null : item.id;
                    app.renderShoppingListItems();
                } else {
                    app.handlers.toggleItem(item.id);
                }
            };

            if (!item.isHeader) {
                var del = document.createElement('button');
                del.className = 'delete-btn-blue';
                del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                del.onclick = function (e) { e.stopPropagation(); app.handlers.deleteItem(item.id); };
                el.appendChild(del);
            }
            list.appendChild(el);
        }

        if (window.Sortable) {
            if (list._sortable) list._sortable.destroy();
            list._sortable = new Sortable(list, { animation: 150, onEnd: function () { app.handlers.reorderItems(); } });
        }
    },

    getStartOfWeek: function (off) {
        var d = new Date(); var day = d.getDay();
        var diff = d.getDate() - day + (day === 0 ? -6 : 1);
        var mon = new Date(d.setDate(diff)); mon.setDate(mon.getDate() + (off * 7)); return mon;
    },

    getWeekNumber: function (d) {
        var date = new Date(d.getTime());
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
        var week1 = new Date(date.getFullYear(), 0, 4);
        return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
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
                    el.onclick = function () {
                        app.state.currentUser = m;
                        app.state.selectedMemberId = m.id;
                        app.ui.closeModals();
                        app.render();
                    }; list.appendChild(el);
                })(app.state.members[i]);
            }
        },
        resetLogin: function () { app.state.currentUser = null; app.auth.showLogin(); },
        logout: function () { app.state.currentUser = null; app.auth.showLogin(); }
    },

    handlers: {
        changeWeek: function (dir) { app.state.currentWeekOffset += dir; app.render(); },
        gotoToday: function () { app.state.currentWeekOffset = 0; app.render(); },
        onAddSidebarItem: function () {
            if (app.state.view === 'calendar') {
                app.handlers.onCellClick(new Date(), 12);
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
                if (app.state.selectedMemberId && m.id === app.state.selectedMemberId) opt.selected = true;
                else if (!app.state.selectedMemberId && app.state.currentUser && m.id === app.state.currentUser.id) opt.selected = true;
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
            if (!confirm('Delete this list?')) return;
            var newStores = [];
            for (var i = 0; i < app.state.storeTypes.length; i++) { if (app.state.storeTypes[i].id !== id) newStores.push(app.state.storeTypes[i]); }
            app.state.storeTypes = newStores;
            var newItems = [];
            for (var j = 0; j < app.state.groceryItems.length; j++) { if (app.state.groceryItems[j].storeId !== id) newItems.push(app.state.groceryItems[j]); }
            app.state.groceryItems = newItems;
            if (app.state.selectedStoreId === id) app.state.selectedStoreId = (app.state.storeTypes[0] ? app.state.storeTypes[0].id : null);
            app.saveData(); app.render();
        },
        moveStore: function (idx, dir) {
            // ... (keep existing)
            var newIdx = idx + dir;
            if (newIdx < 0 || newIdx >= app.state.storeTypes.length) return;
            var temp = app.state.storeTypes[idx];
            app.state.storeTypes[idx] = app.state.storeTypes[newIdx];
            app.state.storeTypes[newIdx] = temp;
            app.saveData(); app.render();
        },
        addHeading: function () {
            app.ui.openModal('heading');
            var form = document.getElementById('form-heading');
            if (form) {
                form.reset();
                setTimeout(function () { form.querySelector('[name=name]').focus(); }, 100);
            }
        },
        onQuickAddItem: function (sid) {
            var input = document.getElementById('shopping-input');
            if (input && input.value.trim()) {
                var val = input.value.trim();
                var text = val;

                var newItem = {
                    id: 'i' + Date.now(),
                    storeId: sid,
                    text: text,
                    checked: false,
                    isHeader: false
                };

                if (app.state.selectedHeaderId) {
                    // Find index of selected header
                    var idx = -1;
                    for (var k = 0; k < app.state.groceryItems.length; k++) {
                        if (app.state.groceryItems[k].id === app.state.selectedHeaderId) { idx = k; break; }
                    }
                    if (idx !== -1) {
                        app.state.groceryItems.splice(idx + 1, 0, newItem);
                    } else {
                        app.state.groceryItems.push(newItem);
                    }
                } else {
                    app.state.groceryItems.push(newItem);
                }

                input.value = '';
                app.saveData();
                app.renderShoppingListItems();

                // Keep window and focus
                setTimeout(function () {
                    var inputRetry = document.getElementById('shopping-input');
                    if (inputRetry) {
                        inputRetry.focus();
                        inputRetry.select();
                    }
                }, 50);
            }
        },
        toggleItem: function (id) {
            for (var i = 0; i < app.state.groceryItems.length; i++) {
                var item = app.state.groceryItems[i];
                if (item.id === id && !item.isHeader) item.checked = !item.checked;
            }
            app.saveData(); app.render();
        },
        deleteItem: function (id) {
            var newList = []; for (var i = 0; i < app.state.groceryItems.length; i++) { if (app.state.groceryItems[i].id !== id) newList.push(app.state.groceryItems[i]); }
            app.state.groceryItems = newList; app.saveData(); app.render();
        },
        deleteAll: function (sid, headId) {
            if (!confirm('Delete all items' + (headId ? ' under this heading' : '') + '?')) return;
            var newList = [];
            var inSection = false;
            for (var i = 0; i < app.state.groceryItems.length; i++) {
                var item = app.state.groceryItems[i];
                if (headId) {
                    if (item.id === headId) { inSection = true; newList.push(item); continue; }
                    if (inSection && item.isHeader) inSection = false;
                    if (!inSection || item.storeId !== sid) newList.push(item);
                } else {
                    if (item.storeId !== sid) newList.push(item);
                }
            }
            app.state.groceryItems = newList; app.saveData(); app.renderShoppingListItems();
        },
        clearCompleted: function (sid, headId) {
            var newList = [];
            var inSection = false;
            for (var i = 0; i < app.state.groceryItems.length; i++) {
                var item = app.state.groceryItems[i];
                if (headId) {
                    if (item.id === headId) { inSection = true; newList.push(item); continue; }
                    if (inSection && item.isHeader) inSection = false;
                    if (inSection && item.storeId === sid && item.checked) continue;
                    newList.push(item);
                } else {
                    if (item.storeId !== sid || !item.checked) newList.push(item);
                }
            }
            app.state.groceryItems = newList; app.saveData(); app.renderShoppingListItems();
        },
        showShoppingMenu: function (e, sid, headId) {
            e.stopPropagation(); e.preventDefault();
            var existing = document.querySelector('.context-menu');
            if (existing) existing.remove();

            var menu = document.createElement('div');
            menu.className = 'context-menu';

            var items = [
                { text: 'Clear Completed', icon: 'fa-check-double', action: function () { app.handlers.clearCompleted(sid, headId); } },
                { text: 'Delete All', icon: 'fa-trash-can', danger: true, action: function () { app.handlers.deleteAll(sid, headId); } }
            ];

            items.forEach(function (item) {
                var el = document.createElement('div');
                el.className = 'menu-item' + (item.danger ? ' danger' : '');
                el.innerHTML = '<i class="fa-solid ' + item.icon + '"></i>' + item.text;
                el.onclick = function () { item.action(); menu.remove(); };
                menu.appendChild(el);
            });

            document.body.appendChild(menu);

            var rect = e.target.getBoundingClientRect();
            menu.style.top = rect.bottom + 5 + 'px';
            menu.style.right = (window.innerWidth - rect.right) + 'px';

            var closer = function () { menu.remove(); document.removeEventListener('click', closer); };
            setTimeout(function () { document.addEventListener('click', closer); }, 10);
        },
        reorderItems: function () {
            var list = document.getElementById('shopping-list-items');
            if (!list) return;
            var newOrderIds = Array.prototype.slice.call(list.children).map(function (el) { return el.getAttribute('data-id'); });
            var sid = app.state.selectedStoreId;
            var otherItems = app.state.groceryItems.filter(function (i) { return i.storeId !== sid; });
            var storeItems = app.state.groceryItems.filter(function (i) { return i.storeId === sid; });
            var sortedStoreItems = newOrderIds.map(function (id) {
                for (var k = 0; k < storeItems.length; k++) { if (storeItems[k].id === id) return storeItems[k]; }
            }).filter(Boolean);
            app.state.groceryItems = otherItems.concat(sortedStoreItems);
            app.saveData();
        }
    },

    ui: {
        openModal: function (n) {
            document.getElementById('modal-overlay').classList.remove('hidden');
            var modals = document.querySelectorAll('.modal'); for (var i = 0; i < modals.length; i++) modals[i].classList.add('hidden');
            var target = document.getElementById('modal-' + n); if (target) target.classList.remove('hidden');

            if (n === 'settings') {
                var f = document.getElementById('form-settings');
                f.querySelector('[name=startHour]').value = app.state.settings.startHour || 8;
                f.querySelector('[name=endHour]').value = app.state.settings.endHour || 20;
            }
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
        document.getElementById('modal-overlay').onclick = function (e) {
            if (e.target.id === 'modal-overlay') {
                app.ui.closeModals();
            }
        };
        var formMem = document.getElementById('form-member');
        if (formMem) formMem.onsubmit = function (e) {
            e.preventDefault(); var fd = new FormData(e.target);
            var id = fd.get('id');
            var memberData = { id: id || ('m' + Date.now()), name: fd.get('name'), color: fd.get('color') };
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
        var formHead = document.getElementById('form-heading');
        if (formHead) formHead.onsubmit = function (e) {
            e.preventDefault();
            var fd = new FormData(e.target);
            var name = fd.get('name');
            if (!name) return;

            var newItem = {
                id: 'i' + Date.now(),
                storeId: app.state.selectedStoreId,
                text: name,
                checked: false,
                isHeader: true
            };

            if (app.state.selectedHeaderId) {
                var idx = -1;
                for (var k = 0; k < app.state.groceryItems.length; k++) {
                    if (app.state.groceryItems[k].id === app.state.selectedHeaderId) { idx = k; break; }
                }
                if (idx !== -1) {
                    app.state.groceryItems.splice(idx + 1, 0, newItem);
                } else {
                    app.state.groceryItems.push(newItem);
                }
            } else {
                app.state.groceryItems.push(newItem);
            }
            app.saveData();
            app.ui.closeModals();
            app.renderShoppingListItems();
        };

        var formSet = document.getElementById('form-settings');
        if (formSet) {
            formSet.onsubmit = function (e) {
                e.preventDefault();
                var fd = new FormData(e.target);
                app.state.settings.startHour = parseInt(fd.get('startHour'));
                app.state.settings.endHour = parseInt(fd.get('endHour'));
                app.saveData();
                app.ui.closeModals();
                app.render();
            };
        }
    }
};

app.init();
