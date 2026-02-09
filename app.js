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
var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhYW1lanpha3psdWRzdWx0bXhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3NTczNjUsImV4cCI6MjA4NDMzMzM2NX0.ZLAFAo-UiaibmQqu_n0Fl4hKaF5zbm4Yicy9DavL4JQ';
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
        view: 'calendar',
        currentWeekOffset: 0,
        appointments: [],
        members: [],
        storeTypes: [],
        groceryItems: [],
        settings: { startHour: 6, endHour: 23 }, // Default settings
        selectedStoreId: null,
        selectedMemberId: null,
        selectedHeaderId: null,
        editingItemId: null,
        family: null,
        currentUser: null,
        dragAllowed: false,
        justDragged: false,
        whatsNewVersion: 'alpha-0.2.2',
        draggingOccurrenceDate: null,
        dropTarget: null,
        expandedDayIndex: null,
        familyId: null,
        lastTypingTime: 0
    },

    api: {
        async fetchFamily() {
            const { data, error: userError } = await supabaseClient.auth.getUser();
            if (userError || !data || !data.user) return null;
            const user = data.user;

            let { data: member, error: memberError } = await supabaseClient.from('family_members').select('*').eq('user_id', user.id).single();

            if (!member) {
                return { status: 'unaffiliated' };
            }

            app.state.familyId = member.family_id;
            app.state.currentUser = member;
            app.state.selectedMemberId = member.id;
            return { status: 'linked', member };
        },

        async loadAllData(familyId, skipRealtime = false) {
            try {
                const [members, appts, stores, items, family] = await Promise.all([
                    supabaseClient.from('family_members').select('*').eq('family_id', familyId).order('position', { ascending: true }),
                    supabaseClient.from('appointments').select('*').eq('family_id', familyId),
                    supabaseClient.from('store_types').select('*').eq('family_id', familyId).order('position', { ascending: true }),
                    supabaseClient.from('grocery_items').select('*').eq('family_id', familyId).order('position', { ascending: true }),
                    supabaseClient.from('families').select('*').eq('id', familyId).single()
                ]);

                if (items.error) {
                    console.error("Column Error Check:", items.error);
                    if (items.error.message.includes("column \"position\" does not exist")) {
                        alert("Database Update Required: Please make sure you ran the SQL query in Supabase to add the 'position' columns.");
                        return;
                    }
                }

                if (family.data) {
                    app.state.family = family.data;
                    // Load time settings from database
                    if (family.data.start_hour !== undefined) {
                        app.state.settings.startHour = family.data.start_hour;
                    }
                    if (family.data.end_hour !== undefined) {
                        app.state.settings.endHour = family.data.end_hour;
                    }
                }
                if (members.data) app.state.members = members.data;
                if (appts.data) {
                    app.state.appointments = appts.data.map(a => ({
                        ...a,
                        memberId: a.member_id,
                        repeatType: a.repeat_type,
                        repeatFrequency: a.repeat_frequency
                    }));
                }
                if (stores.data) app.state.storeTypes = stores.data;
                if (items.data) {
                    app.state.groceryItems = items.data.map(i => ({
                        ...i,
                        storeId: i.store_id,
                        isHeader: i.is_header
                    }));
                }
                app.render();

                // Setup realtime subscriptions after initial data load (skip if called from realtime event)
                if (!skipRealtime) {
                    app.api.setupRealtime(familyId);
                }
            } catch (err) {
                console.error("Load All Data Fatal Error:", err);
                alert("Failed to load data: " + err.message);
            }
        },

        setupRealtime(familyId) {
            // Unsubscribe from any existing channels
            if (app.realtimeChannel) {
                supabaseClient.removeChannel(app.realtimeChannel);
            }

            // Stop any existing polling
            if (app.pollingInterval) {
                clearInterval(app.pollingInterval);
                app.pollingInterval = null;
            }

            console.log('🔴 Setting up Realtime for family:', familyId);

            // Create a channel for this family
            app.realtimeChannel = supabaseClient
                .channel(`family-${familyId}`)
                .on('postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'grocery_items',
                        filter: `family_id=eq.${familyId}`
                    },
                    (payload) => {
                        console.log('🔄 Grocery items changed:', payload);

                        // Don't reload if user typed recently (within 3 seconds)
                        const timeSinceTyping = Date.now() - app.state.lastTypingTime;
                        if (timeSinceTyping < 3000) {
                            console.log('⏸️ Skipping reload - user typed', timeSinceTyping, 'ms ago');
                            return;
                        }

                        // Don't reload if user is actively typing
                        const activeElement = document.activeElement;
                        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                            console.log('⏸️ Skipping reload - user is typing');
                            return;
                        }
                        // Also check if shopping input has content (mobile keyboard might cause focus loss)
                        const shoppingInput = document.getElementById('shopping-input');
                        if (shoppingInput && shoppingInput.value && shoppingInput.value.trim()) {
                            console.log('⏸️ Skipping reload - shopping input has content');
                            return;
                        }
                        app.api.loadAllData(familyId, true); // Skip realtime setup on reload
                    }
                )
                .on('postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'appointments',
                        filter: `family_id=eq.${familyId}`
                    },
                    (payload) => {
                        console.log('🔄 Appointments changed:', payload);
                        const activeElement = document.activeElement;
                        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                            console.log('⏸️ Skipping reload - user is typing');
                            return;
                        }
                        app.api.loadAllData(familyId, true); // Skip realtime setup on reload
                    }
                )
                .on('postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'family_members',
                        filter: `family_id=eq.${familyId}`
                    },
                    (payload) => {
                        console.log('🔄 Members changed:', payload);
                        const activeElement = document.activeElement;
                        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                            console.log('⏸️ Skipping reload - user is typing');
                            return;
                        }
                        app.api.loadAllData(familyId, true); // Skip realtime setup on reload
                    }
                )
                .on('postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'store_types',
                        filter: `family_id=eq.${familyId}`
                    },
                    (payload) => {
                        console.log('🔄 Stores changed:', payload);
                        const activeElement = document.activeElement;
                        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                            console.log('⏸️ Skipping reload - user is typing');
                            return;
                        }
                        app.api.loadAllData(familyId, true); // Skip realtime setup on reload
                    }
                )
                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') {
                        console.log('✅ Realtime connected!');
                    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                        console.warn('⚠️ Realtime unavailable, falling back to polling every 10 seconds');
                        // Fallback to polling
                        app.pollingInterval = setInterval(function () {
                            console.log('🔄 Polling for updates...');
                            app.api.loadAllData(familyId, true); // Skip realtime setup on poll
                        }, 10000);
                    }
                });
        },

        async createFamily(familyName) {
            if (!familyName) return;
            const code = Math.random().toString(36).substring(2, 8).toUpperCase();
            const { data: family, error } = await supabaseClient.from('families').insert({
                name: familyName,
                invite_code: code
            }).select().single();

            if (error) {
                console.error("Create Family Error:", error);
                alert("Failed to create family: " + error.message);
                return;
            }

            if (family) {
                app.state.familyId = family.id;
                app.state.family = family;
                app.auth.showCreateProfile();
            }
        },

        async createFamilyAndMember(familyName, memberName, color) {
            if (!familyName || !memberName) return;

            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) {
                alert('You must be logged in to create a family.');
                return;
            }

            const code = Math.random().toString(36).substring(2, 8).toUpperCase();
            const { data: family, error: familyError } = await supabaseClient.from('families').insert({
                name: familyName,
                invite_code: code
            }).select().single();

            if (familyError) {
                console.error("Create Family Error:", familyError);
                alert("Failed to create family: " + familyError.message);
                return;
            }

            // Create member for this user
            const { data: member, error: memberError } = await supabaseClient.from('family_members').insert({
                family_id: family.id,
                user_id: user.id,
                name: memberName,
                color: color,
                position: 0
            }).select().single();

            if (memberError) {
                console.error("Create Member Error:", memberError);
                alert("Failed to create member: " + memberError.message);
                return;
            }

            app.state.familyId = family.id;
            app.state.family = family;
            app.state.currentUser = member;
            app.state.selectedMemberId = member.id;

            await app.api.loadAllData(family.id);
        },

        async joinFamilyWithCode(code, memberName, color) {
            if (!code || !memberName) return;

            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) {
                alert('You must be logged in to join a family.');
                return;
            }

            const { data: family } = await supabaseClient.from('families').select('*').eq('invite_code', code.toUpperCase()).single();
            if (!family) {
                alert("Invalid invite code. Please check and try again.");
                return;
            }

            // Get the highest position for ordering
            const { data: existingMembers } = await supabaseClient.from('family_members')
                .select('position')
                .eq('family_id', family.id)
                .order('position', { ascending: false })
                .limit(1);

            const nextPosition = existingMembers && existingMembers.length > 0 ? existingMembers[0].position + 1 : 0;

            // Create member for this user
            const { data: member, error: memberError } = await supabaseClient.from('family_members').insert({
                family_id: family.id,
                user_id: user.id,
                name: memberName,
                color: color,
                position: nextPosition
            }).select().single();

            if (memberError) {
                console.error("Join Family Error:", memberError);
                alert("Failed to join family: " + memberError.message);
                return;
            }

            app.state.familyId = family.id;
            app.state.family = family;
            app.state.currentUser = member;
            app.state.selectedMemberId = member.id;

            await app.api.loadAllData(family.id);
        },

        async claimProfile(memberId) {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) return;
            await supabaseClient.from('family_members').update({ user_id: user.id }).eq('id', memberId);
            window.location.reload();
        },

        async createMember(name) {
            const { data: userData, error: userError } = await supabaseClient.auth.getUser();
            if (userError || !userData.user) {
                alert("Authentication error. Please log in again.");
                return;
            }
            const user = userData.user;

            let fid = app.state.familyId;
            if (!fid) {
                // Try to find a family with name "My Family" as fallback
                let { data: f } = await supabaseClient.from('families').select('id').eq('name', 'My Family').single();
                if (f) fid = f.id;
            }

            if (!fid) {
                alert("Error: No Family ID found. Please create or join a family first.");
                return;
            }

            const { data, error } = await supabaseClient.from('family_members').insert({
                family_id: fid,
                user_id: user.id,
                name: name,
                color: '#002c3a'
            }).select().single();

            if (error) {
                console.error("Create Member Error:", error);
                alert("Failed to create profile: " + error.message);
                return;
            }

            window.location.reload();
        },

        async createEmptyMember(name, color) {
            if (!app.state.familyId) {
                alert("Error: No Family ID found.");
                return;
            }
            const { data, error } = await supabaseClient.from('family_members').insert({
                family_id: app.state.familyId,
                name: name,
                color: color || '#666'
            }).select().single();

            if (error) {
                console.error("Create Member Error:", error);
                alert("Failed to create member: " + error.message);
                return;
            }

            if (data) {
                app.state.members.push(data);
                app.render();
            }
        },

        // GRANULAR UPDATES
        async addAppointment(appt) {
            if (!app.state.familyId) {
                alert("Error: No Family ID found. Please try reloading the page.");
                return;
            }
            const dbAppt = {
                family_id: app.state.familyId,
                title: appt.title,
                date: appt.date,
                time: appt.time,
                member_id: appt.memberId,
                comment: appt.comment,
                repeat_type: appt.repeatType,
                repeat_frequency: appt.repeatFrequency
            };
            const { data, error } = await supabaseClient.from('appointments').insert(dbAppt).select().single();
            if (error) {
                console.error("Add Appointment Error:", error);
                alert("Failed to save appointment: " + error.message);
                return;
            }
            if (data) {
                data.memberId = data.member_id;
                data.repeatType = data.repeat_type;
                data.repeatFrequency = data.repeat_frequency;
                app.state.appointments.push(data);
                app.render();
            }
        },
        async updateAppointment(id, updates) {
            const dbUpdates = { ...updates };
            if (updates.memberId) { dbUpdates.member_id = updates.memberId; delete dbUpdates.memberId; }
            if (updates.repeatType) { dbUpdates.repeat_type = updates.repeatType; delete dbUpdates.repeatType; }
            if (updates.repeatFrequency) { dbUpdates.repeat_frequency = updates.repeatFrequency; delete dbUpdates.repeatFrequency; }

            const { data } = await supabaseClient.from('appointments').update(dbUpdates).eq('id', id).select().single();
            if (data) {
                data.memberId = data.member_id;
                data.repeatType = data.repeat_type;
                data.repeatFrequency = data.repeat_frequency;
                const idx = app.state.appointments.findIndex(a => a.id === id);
                if (idx !== -1) app.state.appointments[idx] = data;
                app.render();
            }
        },
        async deleteAppointment(id) {
            const { error } = await supabaseClient.from('appointments').delete().eq('id', id);
            if (error) {
                console.error("Delete Appointment Error:", error);
                alert("Failed to delete appointment: " + error.message);
                return;
            }
            app.state.appointments = app.state.appointments.filter(a => a.id !== id);
            app.render();
        },
        async addGroceryItem(item, insertIndex) {
            if (!app.state.familyId) {
                alert("Error: No Family ID found. Please try reloading the page.");
                return;
            }
            const dbItem = {
                family_id: app.state.familyId,
                store_id: item.storeId,
                text: item.text,
                checked: item.checked,
                is_header: item.isHeader,
                position: item.position || 0
            };
            const { data, error } = await supabaseClient.from('grocery_items').insert(dbItem).select().single();
            if (error) {
                console.error("Add Grocery Error:", error);
                alert("Failed to save item: " + error.message);
                return;
            }
            if (data) {
                data.storeId = data.store_id; data.isHeader = data.is_header;

                if (typeof insertIndex === 'number' && insertIndex >= 0) {
                    app.state.groceryItems.splice(insertIndex, 0, data);
                    app.render();
                    app.handlers.reorderItems();
                } else {
                    app.state.groceryItems.push(data);
                    app.render();
                }
            }
        },
        async bulkUpdatePositions(table, updates) {
            if (!updates || updates.length === 0) return;
            console.log('📝 Updating positions for', table, ':', updates);
            // updates is array of {id, position}
            const { data, error } = await supabaseClient.from(table).upsert(updates, { onConflict: 'id' });
            if (error) {
                console.error("❌ Bulk update error:", error);
                alert("Sync Error: Could not save positions. Check console.");
            } else {
                console.log('✅ Successfully updated positions:', data);
            }
        },
        async updateGroceryItem(id, updates) {
            const dbUpdates = { ...updates };
            if (updates.storeId !== undefined) { dbUpdates.store_id = updates.storeId; delete dbUpdates.storeId; }
            if (updates.isHeader !== undefined) { dbUpdates.is_header = updates.isHeader; delete dbUpdates.isHeader; }

            const { data } = await supabaseClient.from('grocery_items').update(dbUpdates).eq('id', id).select().single();
            if (data) {
                data.storeId = data.store_id; data.isHeader = data.is_header;
                const idx = app.state.groceryItems.findIndex(i => i.id === id);
                if (idx !== -1) app.state.groceryItems[idx] = data;
                app.render();
            }
        },
        async deleteGroceryItem(id) {
            const { error } = await supabaseClient.from('grocery_items').delete().eq('id', id);
            if (error) {
                console.error("Delete Item Error:", error);
                alert("Failed to delete item: " + error.message);
                return;
            }
            app.state.groceryItems = app.state.groceryItems.filter(i => i.id !== id);
            app.render();
        },
        async deleteGroceryItems(ids) {
            if (!ids || ids.length === 0) return;
            const { error } = await supabaseClient.from('grocery_items').delete().in('id', ids);
            if (error) {
                console.error("Delete Items Error:", error);
                alert("Failed to delete items: " + error.message);
                return;
            }
            app.state.groceryItems = app.state.groceryItems.filter(i => !ids.includes(i.id));
            app.render();
        },
        async createStore(name) {
            const { data } = await supabaseClient.from('store_types').insert({ family_id: app.state.familyId, name: name }).select().single();
            if (data) { app.state.storeTypes.push(data); app.render(); }
        },
        async updateStore(id, updates) {
            const { data } = await supabaseClient.from('store_types').update(updates).eq('id', id).select().single();
            if (data) {
                const idx = app.state.storeTypes.findIndex(s => s.id === id);
                if (idx !== -1) app.state.storeTypes[idx] = data;
                app.render();
            }
        },
        async deleteStore(id) {
            // First delete all items in this store
            const { error: itemsError } = await supabaseClient.from('grocery_items').delete().eq('store_id', id);
            if (itemsError) {
                console.error("Delete Store Items Error:", itemsError);
                alert("Failed to delete items: " + itemsError.message);
                return;
            }

            // Then delete the store itself
            const { error: storeError } = await supabaseClient.from('store_types').delete().eq('id', id);
            if (storeError) {
                console.error("Delete Store Error:", storeError);
                alert("Failed to delete list: " + storeError.message);
                return;
            }

            app.state.storeTypes = app.state.storeTypes.filter(s => s.id !== id);
            app.state.groceryItems = app.state.groceryItems.filter(i => i.storeId !== id);
            app.render();
        },
        async updateMember(id, updates) {
            const { data } = await supabaseClient.from('family_members').update(updates).eq('id', id).select().single();
            if (data) {
                const idx = app.state.members.findIndex(m => m.id === id);
                if (idx !== -1) app.state.members[idx] = data;
                app.render();
            }
        },
        async deleteMember(id) {
            const { error } = await supabaseClient.from('family_members').delete().eq('id', id);
            if (error) {
                console.error("Delete Member Error:", error);
                alert("Failed to delete member: " + error.message);
                return;
            }
            app.state.members = app.state.members.filter(m => m.id !== id);
            app.render();
        }
    },

    util: {
        longPress: function (el, callback) {
            let startX = 0;
            let startY = 0;
            let isPressed = false;
            let timer = null;

            function onDown(e) {
                if (e.button !== undefined && e.button !== 0) return;
                isPressed = true;
                startX = e.clientX;
                startY = e.clientY;
                el.classList.remove('drag-ready');

                timer = setTimeout(function () {
                    if (isPressed) {
                        el.classList.add('drag-ready');
                        if (navigator.vibrate) navigator.vibrate(30);
                        if (callback) callback();
                    }
                }, 600); // Increased delay to 600ms to prevent accidental grabs
            }

            function onMove(e) {
                if (!isPressed) return;
                // If moved too much before timer fires, cancel it
                let moveX = Math.abs(e.clientX - startX);
                let moveY = Math.abs(e.clientY - startY);
                if (moveX > 10 || moveY > 10) { // low tolerance to ensure scrolling cancels the hold
                    isPressed = false;
                    clearTimeout(timer);
                    el.classList.remove('drag-ready');
                }
            }

            function onUp() {
                isPressed = false;
                clearTimeout(timer);
                // Delay removing class slightly so click handlers don't fire if it was a drag
                setTimeout(() => el.classList.remove('drag-ready'), 100);
            }

            el.addEventListener('pointerdown', onDown);
            el.addEventListener('pointermove', onMove);
            el.addEventListener('pointerup', onUp);
            el.addEventListener('pointercancel', onUp);
            el.addEventListener('pointerleave', onUp);

            // Clean up old listeners if re-rendering (not strictly necessary here due to recreating elements)
        }
    },

    init: async function () {
        this.setupEventListeners();
        this.setupSwipe();

        // Handle mobile back button for modals
        window.onpopstate = function (event) {
            var visibleModal = document.querySelector('.modal:not(.hidden)');
            if (visibleModal) {
                app.ui.closeModals();
                // Push state again so forward button doesn't do anything weird, effectively trapping back button for modal close
                history.pushState(null, null, location.href);
            }
        };

        // Auth Check
        if (typeof supabaseClient !== 'undefined' && supabaseClient) {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) {
                this.auth.showLogin();
                // Even if not logged in, we might want to render empty or local state? 
                // For now, allow rendering local data if exists or empty.
                this.loadLocalData();
                this.render();
            } else {
                // Load Family Data
                const res = await this.api.fetchFamily();
                if (res && res.status === 'linked') {
                    await this.api.loadAllData(app.state.familyId);
                    this.initRealtime();
                } else if (res && res.status === 'unaffiliated') {
                    this.auth.showFamilySetup();
                } else if (res && res.status === 'claim_needed') {
                    this.auth.showClaimProfile(res.unlinked);
                }
                // If loading failed but we have session, we might still be in a valid local state?
                // Rely on loadAllData to trigger render.
            }
        } else {
            console.warn('Supabase not available, using local data only.');
            this.loadLocalData();
            this.render();
        }

        // Check for updates after a short delay to ensure UI is ready
        setTimeout(() => this.ui.checkWhatsNew(), 1000);
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
        var activeId = document.activeElement ? document.activeElement.id : null;
        var main = document.getElementById('main-view');
        if (!main) return;

        // Prevent input loss on phone while typing
        if (this.state.view === 'shopping' && document.activeElement && document.activeElement.id === 'shopping-input') {
            this.renderSidebar(); // Keep sidebar updated
            this.renderShoppingListItems(); // Update list items only
            return;
        }

        // Save scroll position
        var scrollPos = main.scrollTop;
        var listEl = document.getElementById('shopping-list-items');
        var listScroll = listEl ? listEl.scrollTop : 0;

        main.innerHTML = '';
        this.renderSidebar();

        if (this.state.view === 'calendar') { this.renderCalendar(main); }
        else { this.renderShopping(main); }

        if (activeId) {
            var el = document.getElementById(activeId);
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
                el.focus();
                // Ensure cursor is at the end for text inputs
                if (el.tagName === 'INPUT' && el.type === 'text') {
                    var val = el.value;
                    el.value = ''; el.value = val;
                }
            }
        }

        // Restore scroll position
        main.scrollTop = scrollPos;
        var newListEl = document.getElementById('shopping-list-items');
        if (newListEl) newListEl.scrollTop = listScroll;
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
                    left.className = 'drag-handle';
                    left.style.display = 'flex'; left.style.alignItems = 'center'; left.style.gap = '12px'; left.style.flex = '1';
                    left.innerHTML = '<div class="member-avatar" style="background:' + m.color + '">' + (m.name || 'U')[0] + '</div><span>' + m.name + '</span>';
                    left.onclick = function (e) {
                        // Prevent click if recently dragged
                        if (el.classList.contains('drag-ready') || app.state.justDragged) return;
                        app.state.selectedMemberId = m.id;
                        app.render();
                    };
                    app.util.longPress(el); // Add feedback

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
                    left.className = 'drag-handle';
                    left.style.display = 'flex'; left.style.alignItems = 'center'; left.style.gap = '12px'; left.style.flex = '1';
                    left.innerHTML = '<i class="fa-solid fa-layer-group"></i><span>' + s.name + '</span>';
                    left.onclick = function () {
                        if (el.classList.contains('drag-ready') || app.state.justDragged) return;
                        app.state.selectedStoreId = s.id; app.render();
                    };
                    app.util.longPress(el);

                    var right = document.createElement('div');
                    right.style.display = 'flex'; right.style.alignItems = 'center';

                    var set = document.createElement('button');
                    set.className = 'delete-btn-ghost';
                    set.innerHTML = '<i class="fa-solid fa-gear"></i>';
                    set.style.opacity = '0.4';
                    set.onclick = function (e) { e.stopPropagation(); app.handlers.onEditStore(s); };

                    right.appendChild(set);
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
                handle: '.drag-handle',
                delay: 300,
                delayOnTouchOnly: false,
                touchStartThreshold: 20, // Tolerance for wobble
                onStart: function () { app.state.justDragged = true; list.querySelectorAll('.drag-ready').forEach(el => el.classList.remove('drag-ready')); },
                onEnd: function () {
                    setTimeout(() => app.state.justDragged = false, 100);
                    var newOrderIds = Array.prototype.slice.call(list.children).map(function (el) { return el.getAttribute('data-id'); });
                    var updates = [];
                    if (app.state.view === 'calendar') {
                        var newMembers = newOrderIds.map(function (id, idx) {
                            var m = app.state.members.find(function (m) { return m.id === id; });
                            if (m) {
                                m.position = idx;
                                updates.push({
                                    id: m.id,
                                    position: idx,
                                    family_id: m.family_id,
                                    name: m.name,
                                    color: m.color
                                });
                            }
                            return m;
                        }).filter(Boolean);
                        app.state.members = newMembers;
                        app.api.bulkUpdatePositions('family_members', updates);
                    } else {
                        var newStores = newOrderIds.map(function (id, idx) {
                            var s = app.state.storeTypes.find(function (s) { return s.id === id; });
                            if (s) {
                                console.log('Store object:', s);
                                s.position = idx;
                                updates.push({
                                    id: s.id,
                                    position: idx,
                                    family_id: s.family_id,
                                    name: s.name
                                });
                            }
                            return s;
                        }).filter(Boolean);
                        app.state.storeTypes = newStores;
                        app.api.bulkUpdatePositions('store_types', updates);
                    }
                    app.render();
                }
            });
        }
    },

    renderCalendar: function (container) {
        if (this.state.expandedDayIndex === null) {
            var now = new Date();
            this.state.expandedDayIndex = (now.getDay() + 6) % 7;
        }
        var start = this.getStartOfWeek(this.state.currentWeekOffset);
        var controls = document.createElement('div');
        controls.className = 'calendar-controls';
        var weekNum = this.getWeekNumber(start);
        var fullMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        var shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        var monthIdx = start.getMonth();
        controls.innerHTML = '<div style="display:flex; gap:8px; align-items:center; flex:1; overflow:hidden;">' +
            '<button class="week-nav-btn" onclick="app.handlers.gotoToday()" title="Today" style="border-radius:50%; min-width:36px;"><i class="fa-solid fa-calendar-day"></i></button>' +
            '<div style="display:flex; flex-direction:column; align-items:flex-start; min-width:55px;">' +
            '<small style="font-size:0.65rem; font-weight:800; opacity:0.6; text-transform:uppercase; letter-spacing:1px; color:var(--primary);">Week ' + weekNum + '</small>' +
            '<h3 style="margin:0; line-height:1.2; font-size:0.9rem; font-weight:700;">' +
            '<span class="month-full">' + fullMonths[monthIdx] + '</span>' +
            '<span class="month-short">' + shortMonths[monthIdx] + '</span>' +
            '</h3>' +
            '</div>' +
            '<div style="display:flex; align-items:center; gap:4px; flex:1; justify-content:flex-start;">' +
            '<button class="week-nav-btn" onclick="app.handlers.changeWeek(-4)"><i class="fa-solid fa-angles-left"></i></button>' +
            '<div id="header-week-selector" class="week-selector-container" style="flex:1; max-width:400px; padding: 0 4px;"></div>' +
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
                var dateRange = d.getDate() + '-' + endD.getDate();

                var pill = document.createElement('div');
                var isCurrent = (off === 0);
                pill.className = 'week-pill' + (app.state.currentWeekOffset === off ? ' active' : '') + (isCurrent ? ' current-real-week' : '');

                pill.style.flex = '1';
                pill.style.minWidth = '0'; // Allow shrinking
                pill.style.height = '42px';

                pill.innerHTML =
                    '<div style="font-size:0.9rem; font-weight:900; line-height:1;">W' + num + '</div>' +
                    '<div style="font-size:0.55rem; opacity:0.8; line-height:1; margin-top:2px;">' + dateRange + '</div>';

                pill.onclick = function () { app.state.currentWeekOffset = off; app.render(); };
                weekCont.appendChild(pill);
            })(w);
        }

        var grid = document.createElement('div');
        grid.className = 'calendar-grid';
        grid.id = 'calendar-grid-swipe';

        // Dynamic column widths
        var colDef = "28px ";
        for (var i = 0; i < 7; i++) {
            if (this.state.expandedDayIndex === i) colDef += "3fr ";
            else colDef += "minmax(0, 1fr) ";
        }
        grid.style.gridTemplateColumns = colDef;

        var hTime = document.createElement('div'); hTime.className = 'grid-header';
        hTime.style.display = 'flex'; hTime.style.justifyContent = 'center'; hTime.style.alignItems = 'center';
        hTime.innerHTML = '<i class="fa-solid fa-clock" style="font-size:1rem;"></i>'; // Clock Icon
        grid.appendChild(hTime);
        var days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
        var today = new Date();
        for (var i = 0; i < 7; i++) {
            (function (idx) {
                var hDay = document.createElement('div');
                var currentDay = new Date(start); currentDay.setDate(start.getDate() + idx);
                hDay.className = 'grid-header' + (idx >= 5 ? ' weekend' : '') + (currentDay.toDateString() === today.toDateString() ? ' today' : '');
                if (app.state.expandedDayIndex === idx) hDay.classList.add('expanded');
                // Smaller day names
                hDay.innerHTML = '<small style="font-size:0.65rem; display:block; margin-bottom:2px;">' + days[idx] + '</small>' +
                    '<span style="font-size:0.9rem;">' + currentDay.getDate() + '</span>';
                hDay.onclick = function () {
                    app.state.expandedDayIndex = (app.state.expandedDayIndex === idx) ? null : idx;
                    app.render();
                };
                grid.appendChild(hDay);
            })(i);
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
        for (var h = sH; h <= eH; h++) hours.push({ val: h, label: h });
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
                    var cellDate = new Date(start);
                    cellDate.setDate(start.getDate() + dayIndex);
                    cell.className = 'grid-cell' + (hObj.val % 2 === 0 ? ' row-even' : '') + (dayIndex >= 5 ? ' weekend' : '') + (cellDate.toDateString() === today.toDateString() ? ' today' : '');

                    if (hObj.val >= 0 && hObj.val <= 23) {
                        cell.onclick = function () { app.handlers.onCellClick(cellDate, hObj.val); };
                    }

                    cell.ondragover = function (e) { e.preventDefault(); e.target.classList.add('drag-over'); };
                    cell.ondragleave = function (e) { e.target.classList.remove('drag-over'); };
                    cell.ondrop = function (e) { e.target.classList.remove('drag-over'); app.handlers.onDrop(e, cellDate, hObj.val === -1 ? 0 : (hObj.val === 24 ? 23 : hObj.val)); };

                    var hasAppt = false;
                    for (var j = 0; j < app.state.appointments.length; j++) {
                        (function (appt) {
                            if (app.handlers.isMatchingAppointment(appt, cellDate, hObj, sH, eH)) {
                                hasAppt = true;
                                var m = null;
                                for (var k = 0; k < app.state.members.length; k++) { if (app.state.members[k].id === appt.memberId) m = app.state.members[k]; }
                                var card = document.createElement('div');
                                card.className = 'appointment-card';
                                card.draggable = true;

                                // Unified long press logic
                                var dragTimer = null;
                                var startX = 0, startY = 0;

                                card.onpointerdown = function (e) {
                                    if (e.target.closest('.appt-symbol')) return; // Don't drag symbols
                                    app.state.dragAllowed = false;
                                    startX = e.clientX;
                                    startY = e.clientY;
                                    card.classList.remove('drag-ready');

                                    dragTimer = setTimeout(function () {
                                        app.state.dragAllowed = true;
                                        card.classList.add('drag-ready');
                                        if (navigator.vibrate) navigator.vibrate(20);
                                    }, 300); // 300ms delay for calendar - synced with global longPress
                                };

                                card.onpointermove = function (e) {
                                    if (!dragTimer) return;
                                    var moveX = Math.abs(e.clientX - startX);
                                    var moveY = Math.abs(e.clientY - startY);
                                    if (moveX > 20 || moveY > 20) {
                                        clearTimeout(dragTimer);
                                        dragTimer = null;
                                        app.state.dragAllowed = false;
                                        card.classList.remove('drag-ready');
                                    }
                                };

                                card.onpointerup = function () {
                                    clearTimeout(dragTimer);
                                    dragTimer = null;
                                    setTimeout(() => { app.state.dragAllowed = false; card.classList.remove('drag-ready'); }, 100);
                                };
                                card.onpointerleave = function () {
                                    clearTimeout(dragTimer);
                                    dragTimer = null;
                                    app.state.dragAllowed = false;
                                    card.classList.remove('drag-ready');
                                };

                                card.ondragstart = function (e) {
                                    if (!app.state.dragAllowed) {
                                        e.preventDefault();
                                        return;
                                    }
                                    app.handlers.onDragStart(e, appt, cellDate);
                                };

                                card.style.background = m ? m.color : '#002c3a';
                                card.style.color = 'white';

                                // Dim past appointments
                                var todayD = new Date(); todayD.setHours(0, 0, 0, 0);
                                var apptD = new Date(appt.date);
                                if (apptD < todayD) {
                                    card.classList.add('past');
                                }

                                var t = appt.time || '';
                                // Remove seconds if present
                                if (t.split(':').length === 3) t = t.substring(0, 5);

                                var html = '<div style="display:flex; flex-direction:column; flex:1; overflow:hidden; pointer-events:none;">' +
                                    '<small style="font-size:0.55rem; opacity:0.8; font-weight:700; line-height:1;">' + t + '</small>' +
                                    '<span style="font-size:0.7rem; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + appt.title + '</span>' +
                                    '</div>';
                                if (appt.comment && appt.comment.trim()) {
                                    html += '<span class="appt-symbol" style="width:6px; height:6px; background:red; border-radius:50%; display:inline-block; margin-left:4px;"></span>';
                                }
                                if (appt.repeatType && appt.repeatType !== 'none') {
                                    html += '<span class="appt-symbol" style="font-weight:900; font-size:0.7rem; margin-left:4px;">S</span>';
                                }
                                card.innerHTML = html;
                                card.onclick = function (e) {
                                    if (app.state.dragAllowed) return; // Don't click if we just dragged
                                    e.stopPropagation();
                                    app.handlers.onEditAppointment(appt, cellDate);
                                };
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
        inputWrap.style.gap = '6px';
        inputWrap.style.alignItems = 'center';

        // Input field
        var input = document.createElement('input');
        input.id = 'shopping-input';
        input.type = 'text';

        var selectedHeaderName = '';
        if (this.state.selectedHeaderId) {
            var hItem = this.state.groceryItems.find(i => i.id === this.state.selectedHeaderId);
            if (hItem) selectedHeaderName = hItem.text;
        }

        input.placeholder = selectedHeaderName ? 'Add to ' + selectedHeaderName + '...' : 'Add something...';
        input.style.flex = '1';
        input.value = this.state.currentInputValue || ''; // Restore what user was typing
        input.autocomplete = 'off';
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocapitalize', 'sentences');
        input.name = 'shopping-item-' + Date.now();
        input.oninput = function () {
            app.state.lastTypingTime = Date.now();
            app.state.currentInputValue = this.value; // Save as they type
        };
        input.onkeydown = function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                app.handlers.onQuickAddItem(store.id);
            }
        };
        inputWrap.appendChild(input);

        // Paste button (matched to headingBtn)
        var pasteBtn = document.createElement('button');
        pasteBtn.style.minHeight = '48px';
        pasteBtn.style.minWidth = '48px'; // Same width as heading button
        pasteBtn.style.borderRadius = '14px';
        pasteBtn.style.background = 'white';
        pasteBtn.style.color = 'var(--primary)';
        pasteBtn.style.boxShadow = '0 4px 12px rgba(0,44,58,0.2)'; // Similar shadow strength
        pasteBtn.style.border = 'none';
        pasteBtn.style.cursor = 'pointer';
        pasteBtn.style.display = 'flex';
        pasteBtn.style.alignItems = 'center';
        pasteBtn.style.justifyContent = 'center';
        pasteBtn.style.fontSize = '1.2rem';
        pasteBtn.title = 'Paste from Clipboard';
        pasteBtn.innerHTML = '<i class="fa-solid fa-paste"></i>';
        pasteBtn.onclick = function () { app.handlers.pasteItems(store.id); };
        inputWrap.appendChild(pasteBtn);

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

            // Sort items within this section: unchecked first (by position), then checked (by position)
            var unchecked = g.items.filter(function (item) { return !item.checked; });
            var checked = g.items.filter(function (item) { return item.checked; });

            // Render unchecked items first, then checked items
            for (var j = 0; j < unchecked.length; j++) renderRow(unchecked[j]);
            for (var j = 0; j < checked.length; j++) renderRow(checked[j]);
        }

        function renderRow(item) {
            var el = document.createElement('div');
            el.className = 'shopping-item' + (item.checked ? ' checked' : '') + (item.isHeader ? ' is-header' : '') + ' interactive-item';
            if (item.isHeader && app.state.selectedHeaderId === item.id) el.classList.add('header-selected');
            el.setAttribute('data-id', item.id);

            // Left side content
            if (item.isHeader) {
                var titleSpan = document.createElement('span');
                titleSpan.style.flex = '1';
                titleSpan.style.fontWeight = '800';
                titleSpan.style.padding = '5px 0';
                titleSpan.textContent = item.text;
                el.appendChild(titleSpan);
            } else {
                var checkDiv = document.createElement('div');
                checkDiv.className = 'check-circle' + (item.checked ? ' checked' : '');
                checkDiv.onclick = function (e) { e.stopPropagation(); app.handlers.toggleItem(item.id); };
                el.appendChild(checkDiv);

                var textSpan = document.createElement('span');
                textSpan.style.flex = '1';
                textSpan.style.marginLeft = '15px';
                textSpan.style.padding = '5px 0';
                if (item.checked) {
                    textSpan.style.textDecoration = 'line-through';
                    textSpan.style.opacity = '0.5';
                }
                textSpan.textContent = item.text;
                el.appendChild(textSpan);
            }

            if (item.isHeader) {
                var hEdit = document.createElement('button');
                hEdit.className = 'delete-btn-blue';
                hEdit.style.marginRight = '8px';
                hEdit.innerHTML = '<i class="fa-solid fa-ellipsis"></i>';
                hEdit.onclick = function (e) { e.stopPropagation(); app.handlers.editItemText(item.id); };
                el.appendChild(hEdit);

                var hDel = document.createElement('button');
                hDel.className = 'delete-btn-blue';
                hDel.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                hDel.onclick = function (e) { e.stopPropagation(); if (confirm('Delete heading "' + item.text + '"?')) app.handlers.deleteItem(item.id); };
                el.appendChild(hDel);
            } else {
                var edit = document.createElement('button');
                edit.className = 'delete-btn-blue';
                edit.style.marginRight = '8px';
                edit.innerHTML = '<i class="fa-solid fa-ellipsis"></i>';
                edit.onclick = function (e) { e.stopPropagation(); app.handlers.editItemText(item.id); };
                el.appendChild(edit);

                var del = document.createElement('button');
                del.className = 'delete-btn-blue';
                del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                del.onclick = function (e) { e.stopPropagation(); app.handlers.deleteItem(item.id); };
                el.appendChild(del);
            }

            // Dragging is now allowed on the whole item except buttons

            el.onclick = function (e) {
                if (e.target.closest('button') || e.target.closest('.check-circle')) return;
                // If just dragged or drag ready, ignore click
                if (el.classList.contains('drag-ready') || app.state.justDragged) return;

                if (item.isHeader) {
                    app.state.selectedHeaderId = (app.state.selectedHeaderId === item.id) ? null : item.id;
                    app.render();
                }
            };

            // Add long press feedback
            app.util.longPress(el);

            list.appendChild(el);
        }

        if (window.Sortable) {
            if (list._sortable) list._sortable.destroy();
            list._sortable = new Sortable(list, {
                animation: 150,
                draggable: '.shopping-item:not(.is-header)', // Only draggable if not a header
                handle: '.shopping-item:not(.is-header)', // Dragging on the whole item (except buttons/checkbox)
                delay: 300,
                delayOnTouchOnly: false, // Apply delay to mouse too for consistency
                touchStartThreshold: 20, // Tolerance for wobble
                filter: '.check-circle, .delete-btn-blue, button, i',
                preventOnFilter: true,
                onStart: function () { list.querySelectorAll('.drag-ready').forEach(el => el.classList.remove('drag-ready')); },
                onEnd: function () { app.handlers.reorderItems(); }
            });
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

    saveData: function (skipHistory) {
        var payload = { members: this.state.members, appointments: this.state.appointments, storeTypes: this.state.storeTypes, groceryItems: this.state.groceryItems, settings: this.state.settings };

        if (!skipHistory) {
            this.state.history.push(JSON.stringify(payload));
            if (this.state.history.length > this.state.maxHistory) this.state.history.shift();
            var btn = document.getElementById('btn-undo');
            if (btn) btn.style.setProperty('display', (this.state.history.length > 1) ? 'flex' : 'none', 'important');
        }

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
        },
        signIn: async function (provider) {
            await supabaseClient.auth.signInWithOAuth({
                provider: provider,
                options: { redirectTo: window.location.href }
            });
        },
        authMode: 'login',
        toggleMode: function () {
            this.authMode = (this.authMode === 'login' ? 'signup' : 'login');
            const isLogin = (this.authMode === 'login');
            document.getElementById('auth-mode-title').textContent = isLogin ? 'Sign in with your password:' : 'Create a new family account:';
            document.getElementById('btn-login-submit').textContent = isLogin ? 'Sign In' : 'Sign Up';
            document.getElementById('toggle-auth-mode').textContent = isLogin ? "Don't have an account? Sign Up" : "Already have an account? Sign In";
        },
        handlePasswordAuth: async function () {
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            const msg = document.getElementById('login-msg');
            const submitBtn = document.getElementById('btn-login-submit');

            if (!email || !password) {
                alert("Please enter both email and password.");
                return;
            }

            msg.style.display = 'none';
            submitBtn.disabled = true;
            submitBtn.textContent = 'Processing...';

            let result;
            try {
                if (this.authMode === 'login') {
                    result = await supabaseClient.auth.signInWithPassword({ email, password });
                } else {
                    result = await supabaseClient.auth.signUp({ email, password });
                    if (!result.error && !result.data.session) {
                        alert("Account created! PLEASE NOTE: You must click the confirmation link sent to your email before you can log in.");
                        this.toggleMode();
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Sign In';
                        return;
                    }
                }

                if (result.error) {
                    msg.textContent = result.error.message;
                    msg.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.textContent = (this.authMode === 'login' ? 'Sign In' : 'Sign Up');
                } else {
                    window.location.reload();
                }
            } catch (err) {
                msg.textContent = "Unexpected error: " + err.message;
                msg.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.textContent = (this.authMode === 'login' ? 'Sign In' : 'Sign Up');
            }
        },
        logout: async function () {
            await supabaseClient.auth.signOut();
            window.location.reload();
        },
        showJoinMenu: function () {
            document.getElementById('modal-overlay').classList.remove('hidden');
            document.getElementById('modal-login').classList.remove('hidden');
            const container = document.querySelector('#modal-login div');
            container.innerHTML = `
                <h3 style="margin-top:0;">Setup Family</h3>
                <p style="font-size:0.9rem; opacity:0.8; margin-bottom:20px;">Join an existing family or start a new one.</p>
                
                <div style="background:#f9f9f9; padding:15px; border-radius:12px; margin-bottom:15px;">
                    <p style="font-size:0.75rem; font-weight:700; color:#666; margin-bottom:10px;">JOIN WITH CODE</p>
                    <input type="text" id="join-code" placeholder="6-digit code (e.g. A7Z9P2)" style="width:100%; box-sizing:border-box; text-transform:uppercase;">
                    <button class="btn-primary" onclick="app.api.joinFamilyWithCode(document.getElementById('join-code').value)" style="width:100%; height:40px; margin-top:10px;">Join Family</button>
                </div>

                <div style="text-align:center; margin-bottom:15px; position:relative;">
                    <span style="background:white; padding:0 10px; font-size:0.75rem; color:#999; z-index:1; position:relative;">OR</span>
                    <hr style="position:absolute; top:50%; left:0; right:0; border:none; border-top:1px solid #eee; margin:0;">
                </div>

                <button class="btn-text" onclick="app.api.createFamily(prompt('Enter your Family Name:'))" style="width:100%; border:1px solid #eee;">
                    + Create New Family
                </button>
            `;
        },
        showClaimProfile: function (unlinkedMembers) {
            document.getElementById('modal-overlay').classList.remove('hidden');
            document.getElementById('modal-login').classList.remove('hidden');
            const container = document.querySelector('#modal-login div');
            container.innerHTML = '<h3>Who are you?</h3><p class="mb-4" style="font-size:0.9rem; opacity:0.8;">Select your name to link your account:</p>';

            unlinkedMembers.forEach(m => {
                const btn = document.createElement('button');
                btn.className = 'btn-text';
                btn.style.width = '100%';
                btn.style.justifyContent = 'flex-start';
                btn.style.border = '1px solid #eee';
                btn.style.padding = '12px';
                btn.style.marginBottom = '8px';
                btn.innerHTML = `<div class="member-avatar" style="background:${m.color}; margin-right:12px;">${m.name[0]}</div> <span>${m.name}</span>`;
                btn.onclick = () => app.api.claimProfile(m.id);
                container.appendChild(btn);
            });

            const createBtn = document.createElement('div');
            createBtn.style.marginTop = '10px';
            createBtn.innerHTML = '<button class="btn-text" style="color:var(--primary); font-weight:700;">+ I\'m not on this list</button>';
            createBtn.onclick = () => app.auth.showCreateProfile();
            container.appendChild(createBtn);
        },
        showCreateProfile: function () {
            const name = prompt("Enter your name:");
            if (name) app.api.createMember(name);
        }
    },

    handlers: {
        undo: function () {
            // Undo not supported in granular sync yet (requires complexity)
            alert("Undo not available in cloud beta");
        },
        onSettings: function () {
            app.ui.openModal('settings');
            const form = document.getElementById('form-settings');
            form.querySelector('[name=startHour]').value = app.state.settings.startHour;
            form.querySelector('[name=endHour]').value = app.state.settings.endHour;

            // Show invite code
            const codeEl = document.getElementById('family-invite-code');
            if (codeEl && app.state.family) {
                codeEl.textContent = app.state.family.invite_code || 'N/A';
            }
        },
        changeWeek: function (dir) { app.state.currentWeekOffset += dir; app.render(); },
        gotoToday: function () { app.state.currentWeekOffset = 0; app.render(); },
        onAddSidebarItem: function () {
            if (app.state.view === 'calendar') {
                app.ui.openModal('member');
                document.getElementById('member-modal-title').textContent = 'New Member';
                document.getElementById('btn-delete-member').style.display = 'none';
                var form = document.getElementById('form-member');
                form.reset(); form.querySelector('[name=id]').value = '';
            } else {
                app.ui.openModal('store');
                document.getElementById('store-modal-title').textContent = 'New List';
                document.getElementById('btn-delete-store').style.display = 'none';
                var form = document.getElementById('form-store');
                form.reset(); form.querySelector('[name=id]').value = '';
            }
        },
        onAddNewItem: function () {
            if (app.state.view === 'calendar') {
                app.handlers.onCellClick(new Date(), 12);
            } else {
                app.handlers.onAddSidebarItem();
            }
        },
        onEditStore: function (s) {
            app.ui.openModal('store');
            document.getElementById('store-modal-title').textContent = 'Edit List';
            document.getElementById('btn-delete-store').style.display = 'block';
            var form = document.getElementById('form-store');
            form.querySelector('[name=id]').value = s.id;
            form.querySelector('[name=name]').value = s.name;
        },
        deleteStoreAction: function () {
            var id = document.getElementById('form-store').querySelector('[name=id]').value;
            if (id) {
                app.handlers.deleteStore(id);
                app.ui.closeModals();
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
            app.api.deleteMember(id);
            if (app.state.currentUser && app.state.currentUser.id === id) app.state.currentUser = null;
            app.ui.closeModals();
        },
        onCellClick: function (d, h) {
            app.ui.openModal('appointment');
            document.getElementById('btn-delete-appt').style.display = 'none';
            var form = document.getElementById('form-appointment');
            form.reset(); form.querySelector('[name=id]').value = '';

            // Clean logic for selecting self
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
            form.querySelector('[name=repeatType]').value = 'none';
            app.ui.toggleRepeatUI('none');
            form.querySelector('[name=repeatFrequency]').value = 4;
            form.querySelector('[name=title]').focus();
        },
        onEditAppointment: function (appt, occurrenceDate) {
            app.ui.openModal('appointment');
            document.getElementById('btn-delete-appt').style.display = 'block';
            var form = document.getElementById('form-appointment');
            form.querySelector('[name=id]').value = appt.id;
            form.querySelector('[name=occurrenceDate]').value = occurrenceDate ? occurrenceDate.toISOString().split('T')[0] : '';
            form.querySelector('[name=title]').value = appt.title;
            form.querySelector('[name=date]').value = appt.date;
            form.querySelector('[name=time]').value = appt.time;
            form.querySelector('[name=comment]').value = appt.comment || '';
            form.querySelector('[name=repeatType]').value = appt.repeatType || 'none';
            app.ui.toggleRepeatUI(appt.repeatType || 'none'); // Fix logic to show if active

            var freq = appt.repeatFrequency || 1;
            var isCustom = (freq > 4);
            var btns = document.querySelectorAll('#repeat-freq-btns .group-btn');
            btns.forEach(function (b) {
                b.classList.remove('active');
                if (isCustom && b.getAttribute('data-val') === 'custom') b.classList.add('active');
                if (!isCustom && b.getAttribute('data-val') == freq) b.classList.add('active');
            });
            document.getElementById('repeat-frequency-input').style.display = isCustom ? 'block' : 'none';

            var select = document.getElementById('appt-member-select'); select.innerHTML = '';
            for (var i = 0; i < app.state.members.length; i++) {
                var m = app.state.members[i];
                var opt = document.createElement('option'); opt.value = m.id; opt.textContent = m.name;
                if (m.id === appt.memberId) opt.selected = true;
                select.appendChild(opt);
            }
        },
        deleteAppointment: function () {
            var form = document.getElementById('form-appointment');
            var id = form.querySelector('[name=id]').value;
            // Simplified delete for now (no recurrence advanced logic)
            if (id) app.api.deleteAppointment(id);
            app.ui.closeModals();
        },
        deleteStore: function (id) {
            app.ui.showChoiceModal('Delete List', 'Delete this entire list and all its items?', [{
                label: 'Delete Everything',
                danger: true,
                action: function () {
                    app.api.deleteStore(id);
                    if (app.state.selectedStoreId === id) app.state.selectedStoreId = (app.state.storeTypes[0] ? app.state.storeTypes[0].id : null);
                    app.ui.closeModals();
                }
            }]);
        },
        moveStore: function (idx, dir) {
            // Not easily supported in granular DB without position column update
            // Skipping for first pass
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
                var newItem = {
                    storeId: sid,
                    text: input.value.trim(),
                    checked: false,
                    isHeader: false
                };

                // If a header is selected, try to insert it after that header/group
                var insertIndex = -1;
                if (app.state.selectedHeaderId) {
                    var items = app.state.groceryItems;
                    var headerIdx = items.findIndex(i => i.id === app.state.selectedHeaderId);
                    if (headerIdx !== -1) {
                        // Find end of this group
                        var endIdx = headerIdx;
                        for (var i = headerIdx + 1; i < items.length; i++) {
                            if (items[i].isHeader) break;
                            endIdx = i;
                        }
                        insertIndex = endIdx + 1;
                    }
                }

                app.api.addGroceryItem(newItem, insertIndex);
                input.value = '';
                app.state.currentInputValue = '';
                input.focus();
            }
        },
        toggleItem: function (id) {
            var item = app.state.groceryItems.find(i => i.id === id);
            if (item) app.api.updateGroceryItem(id, { checked: !item.checked });
        },
        deleteItem: function (id) {
            app.api.deleteGroceryItem(id);
        },
        editItemText: function (id) {
            var item = app.state.groceryItems.find(i => i.id === id);
            if (!item) return;

            // Store the item ID for the form handler
            app.state.editingItemId = id;

            // Open modal and populate
            app.ui.openModal('edit-item');
            document.getElementById('edit-item-title').textContent = item.isHeader ? 'Edit Heading' : 'Edit Item';
            document.getElementById('edit-item-text').value = item.text;

            // Show options only for headers
            var optionsDiv = document.getElementById('edit-item-options');
            if (item.isHeader) {
                optionsDiv.style.display = 'block';
            } else {
                optionsDiv.style.display = 'none';
            }

            // Focus the input
            setTimeout(() => document.getElementById('edit-item-text').focus(), 100);
        },
        deleteAllItems: function () {
            if (!app.state.editingItemId) return;
            var item = app.state.groceryItems.find(i => i.id === app.state.editingItemId);
            if (!item || !item.isHeader) return;

            if (!confirm("Delete all items under this heading?")) return;

            var storeItems = app.state.groceryItems.filter(i => i.storeId === item.storeId);
            var headIdx = storeItems.findIndex(i => i.id === item.id);
            if (headIdx === -1) return;

            var nextHeadIdx = storeItems.findIndex((i, idx) => idx > headIdx && i.isHeader);
            var endIdx = nextHeadIdx === -1 ? storeItems.length : nextHeadIdx;

            for (var i = headIdx + 1; i < endIdx; i++) {
                if (!storeItems[i].isHeader) {
                    app.api.deleteGroceryItem(storeItems[i].id);
                }
            }

            app.ui.closeModals();
        },
        deleteClearedItems: function () {
            if (!app.state.editingItemId) return;
            var item = app.state.groceryItems.find(i => i.id === app.state.editingItemId);
            if (!item || !item.isHeader) return;

            if (!confirm("Delete all checked items under this heading?")) return;

            var storeItems = app.state.groceryItems.filter(i => i.storeId === item.storeId);
            var headIdx = storeItems.findIndex(i => i.id === item.id);
            if (headIdx === -1) return;

            var nextHeadIdx = storeItems.findIndex((i, idx) => idx > headIdx && i.isHeader);
            var endIdx = nextHeadIdx === -1 ? storeItems.length : nextHeadIdx;

            for (var i = headIdx + 1; i < endIdx; i++) {
                if (!storeItems[i].isHeader && storeItems[i].checked) {
                    app.api.deleteGroceryItem(storeItems[i].id);
                }
            }

            app.ui.closeModals();
        },
        pasteItems: async function (storeId) {
            try {
                var text = await navigator.clipboard.readText();
                if (!text || !text.trim()) {
                    alert('Clipboard is empty!');
                    return;
                }

                // Check if text has multiple lines
                var lines = text.split('\n').map(l => l.trim()).filter(l => l);

                if (lines.length === 1) {
                    // Only one line, just add it
                    app.api.addGroceryItem({
                        storeId: storeId,
                        text: lines[0],
                        checked: false,
                        isHeader: false
                    });
                } else {
                    // Multiple lines - show choice
                    app.ui.showChoice(
                        'Paste Items',
                        'Found ' + lines.length + ' lines. How do you want to paste?',
                        [
                            {
                                label: 'As One Item',
                                icon: 'fa-solid fa-minus',
                                action: function () {
                                    app.api.addGroceryItem({
                                        storeId: storeId,
                                        text: text.trim(),
                                        checked: false,
                                        isHeader: false
                                    });
                                }
                            },
                            {
                                label: 'Split by Lines (' + lines.length + ' items)',
                                icon: 'fa-solid fa-list',
                                action: function () {
                                    lines.forEach(function (line) {
                                        app.api.addGroceryItem({
                                            storeId: storeId,
                                            text: line,
                                            checked: false,
                                            isHeader: false
                                        });
                                    });
                                }
                            }
                        ]
                    );
                }
            } catch (err) {
                console.error('Paste error:', err);
                alert('Could not read clipboard. Please make sure you have granted clipboard permissions.');
            }
        },
        copyCalendarSyncLink: function () {
            var url = document.getElementById('calendar-sync-url').value;
            if (url && url !== 'Loading link...') {
                navigator.clipboard.writeText(url)
                    .then(() => alert('Calendar sync link copied!'))
                    .catch(err => {
                        console.error('Copy failed:', err);
                        alert('Could not copy link automatically. Please select the text and copy manually.');
                    });
            }
        },
        deleteAll: function (sid, headId) {
            if (!confirm("Are you sure you want to delete items?")) return;

            var storeItems = app.state.groceryItems.filter(function (i) { return i.storeId === sid; });
            var toDelete = [];

            if (headId) {
                // Delete everything under specific header
                var foundHeader = false;
                for (var i = 0; i < storeItems.length; i++) {
                    var item = storeItems[i];
                    if (item.id === headId) {
                        foundHeader = true;
                        toDelete.push(item.id);
                    } else if (foundHeader) {
                        if (item.isHeader) break; // Next header reached
                        toDelete.push(item.id);
                    }
                }
            } else {
                // Delete ALL items in the store
                toDelete = storeItems.map(i => i.id);
            }

            if (toDelete.length > 0) {
                app.api.deleteGroceryItems(toDelete);
            }
        },
        clearCompleted: function (sid, headId) {
            var storeItems = app.state.groceryItems.filter(function (i) { return i.storeId === sid; });
            var toDelete = [];

            if (headId) {
                // Clear completed under specific header
                var foundHeader = false;
                for (var i = 0; i < storeItems.length; i++) {
                    var item = storeItems[i];
                    if (item.id === headId) {
                        foundHeader = true;
                    } else if (foundHeader) {
                        if (item.isHeader) break;
                        if (item.checked) toDelete.push(item.id);
                    }
                }
            } else {
                // Clear ALL completed items in the store
                toDelete = storeItems.filter(i => i.checked && !i.isHeader).map(i => i.id);
            }

            if (toDelete.length > 0) {
                app.api.deleteGroceryItems(toDelete);
            } else {
                alert("No checked items found.");
            }
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
            var listEl = document.getElementById('shopping-list-items');
            if (!listEl) return;

            var newOrderIds = Array.prototype.slice.call(listEl.children).map(function (el) { return el.getAttribute('data-id'); });
            var sid = app.state.selectedStoreId;
            var updates = [];

            console.log('🔄 Reordering items. New order IDs:', newOrderIds);

            // Reorder the full global list to maintain consistency
            // Strategy: 
            // 1. Get items NOT in this store
            // 2. Get items IN this store and sort them according to newOrderIds
            // 3. Combine them

            var otherItems = app.state.groceryItems.filter(i => i.storeId !== sid);
            var thisStoreItems = app.state.groceryItems.filter(i => i.storeId === sid);
            var sortedThisStore = newOrderIds.map((id, idx) => {
                var item = thisStoreItems.find(i => i.id === id);
                if (item) {
                    item.position = idx;
                    // Include all required fields to satisfy NOT NULL constraints
                    updates.push({
                        id: item.id,
                        position: idx,
                        family_id: item.family_id,
                        text: item.text,
                        store_id: item.storeId,
                        checked: item.checked,
                        is_header: item.isHeader
                    });
                }
                return item;
            }).filter(Boolean);

            app.state.groceryItems = [...otherItems, ...sortedThisStore];

            console.log('📦 Updates to send:', updates);

            if (updates.length > 0) {
                app.api.bulkUpdatePositions('grocery_items', updates);
            }

            app.renderShoppingListItems();
        },
        onDragStart: function (e, appt, occurrenceDate) {
            console.log('🎯 Drag started:', appt.title, 'on', occurrenceDate);
            // Store the appointment being dragged
            app.state.draggingAppt = appt;
            app.state.draggingOccurrenceDate = occurrenceDate;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', e.target.innerHTML);
        },
        onDrop: function (e, date, hour) {
            console.log('📍 Drop triggered on:', date, 'at hour:', hour);
            e.preventDefault();
            if (!app.state.draggingAppt) {
                console.log('⚠️ No appointment being dragged!');
                return;
            }

            var appt = app.state.draggingAppt;
            var occurrenceDate = app.state.draggingOccurrenceDate;

            // Format the new date (use local timezone, not UTC)
            var newDate = new Date(date);
            var year = newDate.getFullYear();
            var month = String(newDate.getMonth() + 1).padStart(2, '0');
            var day = String(newDate.getDate()).padStart(2, '0');
            var newDateStr = year + '-' + month + '-' + day;

            // Format the new time
            var newTime = hour + ':00';

            // If it's a repeating appointment, add an exception for the old occurrence
            if (appt.repeatType && appt.repeatType !== 'none') {
                var oldDate = new Date(occurrenceDate);
                var oldYear = oldDate.getFullYear();
                var oldMonth = String(oldDate.getMonth() + 1).padStart(2, '0');
                var oldDay = String(oldDate.getDate()).padStart(2, '0');
                var oldDateStr = oldYear + '-' + oldMonth + '-' + oldDay;
                var exceptions = appt.exceptions || [];
                if (exceptions.indexOf(oldDateStr) === -1) {
                    exceptions.push(oldDateStr);
                }

                // Create a new one-time appointment for the new date/time
                app.api.addAppointment({
                    memberId: appt.memberId,
                    title: appt.title,
                    date: newDateStr,
                    time: newTime,
                    comment: appt.comment,
                    repeatType: 'none',
                    repeatFrequency: 1
                });

                // Update the original to add the exception
                app.api.updateAppointment(appt.id, { exceptions: exceptions });
            } else {
                // Simple move for non-repeating appointments
                app.api.updateAppointment(appt.id, {
                    date: newDateStr,
                    time: newTime
                });
            }

            console.log('✅ Appointment moved to:', newDateStr, 'at', newTime);

            // Clear drag state
            app.state.draggingAppt = null;
            app.state.draggingOccurrenceDate = null;
        },
        isMatchingAppointment: function (appt, cellDate, hObj, sH, eH) {
            // Keep existing logic
            var ad = new Date(appt.date);
            var ah = parseInt(appt.time);
            var isBaseMatch = (hObj.val === -1 && ah < sH) || (hObj.val === 24 && ah > eH) || (ah === hObj.val);
            if (!isBaseMatch) return false;

            var dateStr = cellDate.toISOString().split('T')[0];
            if (appt.exceptions && appt.exceptions.indexOf(dateStr) !== -1) return false;

            if (ad.toDateString() === cellDate.toDateString()) return true;
            if (!appt.repeatType || appt.repeatType === 'none') return false;

            var dCell = new Date(cellDate); dCell.setHours(0, 0, 0, 0);
            var dStart = new Date(ad); dStart.setHours(0, 0, 0, 0);
            if (dCell < dStart) return false;

            var diffDays = Math.floor((dCell - dStart) / (1000 * 60 * 60 * 24));
            var limit = appt.repeatFrequency || 1;

            if (appt.repeatType === 'weekly') {
                var isSameDayOfWeek = (dCell.getDay() === dStart.getDay());
                var weekDiff = Math.floor(diffDays / 7);
                // "limit" is total weeks (e.g. 1 means only current week)
                return isSameDayOfWeek && (weekDiff < limit);
            }
            if (appt.repeatType === 'monthly') {
                if (dCell.getDate() !== dStart.getDate()) return false;
                var monthsDiff = (dCell.getFullYear() - dStart.getFullYear()) * 12 + (dCell.getMonth() - dStart.getMonth());
                // "limit" is total months
                return (monthsDiff < limit);
            }
            return false;
        },
        showFamilySetup: function () {
            app.ui.openModal('family-setup');
        },
        showCreateFamily: function () {
            app.ui.openModal('create-family');
        },
        showJoinFamily: function () {
            app.ui.openModal('join-family');
        },
        backToFamilySetup: function () {
            app.ui.openModal('family-setup');
        }
    },

    ui: {
        checkWhatsNew: function () {
            var lastSeen = localStorage.getItem('whatsNewSeen');
            if (lastSeen !== app.state.whatsNewVersion) {
                // Small delay to ensure modal overlay is ready/z-index correct
                setTimeout(() => app.ui.openModal('whats-new'), 500);
            }
        },
        closeWhatsNew: function (dontShow) {
            if (dontShow) {
                localStorage.setItem('whatsNewSeen', app.state.whatsNewVersion);
            }
            app.ui.closeModals();
        },
        openModal: function (n) {
            // Push state for back button handling
            history.pushState({ modal: n }, '');

            document.getElementById('modal-overlay').classList.remove('hidden');
            var modals = document.querySelectorAll('.modal');
            for (var i = 0; i < modals.length; i++) { modals[i].classList.add('hidden'); }
            var target = document.getElementById('modal-' + n);
            if (target) target.classList.remove('hidden');

            if (n === 'settings') {
                var f = document.getElementById('form-settings');
                f.querySelector('[name=startHour]').value = app.state.settings.startHour || 8;
                f.querySelector('[name=endHour]').value = app.state.settings.endHour || 20;

                const codeEl = document.getElementById('family-invite-code');
                if (codeEl) codeEl.textContent = (app.state.family && app.state.family.invite_code) || '------';

                // Set the iCal sync URL
                const syncUrlEl = document.getElementById('calendar-sync-url');
                if (syncUrlEl && app.state.familyId) {
                    // Replace with your actual project URL if different
                    const projectUrl = 'https://iaamejzakzludsultmxo.supabase.co';
                    syncUrlEl.value = projectUrl + '/functions/v1/calendar-feed?id=' + app.state.familyId;
                }
            }
        },
        closeModals: function (skipPop) {
            // Removed currentUser check to allow closing generic modals (like What's New) even if not logged in
            document.getElementById('modal-overlay').classList.add('hidden');
            if (!skipPop) history.back();
        },
        showChoice: function (title, message, buttons) {
            // Push state for back button handling
            history.pushState({ modal: 'choice' }, '');

            // Use the existing choice modal
            document.getElementById('modal-overlay').classList.remove('hidden');
            var modals = document.querySelectorAll('.modal');
            for (var i = 0; i < modals.length; i++) { modals[i].classList.add('hidden'); }

            var modal = document.getElementById('modal-choice');
            if (!modal) return;

            modal.classList.remove('hidden');
            document.getElementById('choice-title').textContent = title;
            document.getElementById('choice-text').textContent = message;

            var buttonsContainer = document.getElementById('choice-buttons');
            buttonsContainer.innerHTML = '';

            buttons.forEach(function (btn) {
                var button = document.createElement('button');
                button.className = 'btn-primary';
                button.style.padding = '16px';
                button.style.fontSize = '1rem';
                button.style.borderRadius = '12px';
                button.style.background = 'var(--primary)';
                button.style.color = 'white';
                button.style.border = 'none';
                button.style.cursor = 'pointer';
                button.style.fontWeight = '600';
                button.style.display = 'flex';
                button.style.alignItems = 'center';
                button.style.justifyContent = 'center';
                button.style.gap = '8px';

                if (btn.icon) {
                    button.innerHTML = '<i class="' + btn.icon + '"></i> ' + btn.label;
                } else {
                    button.textContent = btn.label;
                }

                button.onclick = function () {
                    btn.action();
                    app.ui.closeModals();
                };

                buttonsContainer.appendChild(button);
            });
        },
        toggleSidebar: function (open) {
            document.getElementById('sidebar').classList.toggle('mobile-open', open);
            document.getElementById('sidebar-overlay').classList.toggle('active', open);
        },
        toggleRepeatUI: function (val) {
            var wrap = document.getElementById('repeat-freq-wrap');
            var label = document.getElementById('repeat-duration-label');
            if (val === 'none') {
                if (wrap) wrap.style.display = 'none';
            } else {
                if (wrap) wrap.style.display = 'block';
                if (label) label.textContent = 'Total ' + (val === 'weekly' ? 'weeks' : 'months') + ' (including this one):';
            }
        },
        showChoiceModal: function (title, text, choices) {
            document.getElementById('choice-title').textContent = title;
            document.getElementById('choice-text').textContent = text;
            var container = document.getElementById('choice-buttons');
            if (!container) return;
            container.innerHTML = '';
            choices.forEach(function (c) {
                var btn = document.createElement('button');
                btn.className = 'btn-primary';
                btn.style.height = '48px';
                btn.style.borderRadius = '12px';
                btn.style.fontWeight = '700';
                if (c.secondary) {
                    btn.style.background = 'white';
                    btn.style.color = 'var(--primary)';
                    btn.style.border = '2px solid var(--primary)';
                }
                if (c.danger) {
                    btn.style.background = '#ff4444';
                    btn.style.border = 'none';
                    btn.style.color = 'white';
                }
                btn.textContent = c.label;
                btn.onclick = function () {
                    c.action();
                };
                container.appendChild(btn);
            });
            this.openModal('choice');
        }
    },

    setupSwipe: function () {
        var self = this;
        var startX = 0;
        var startY = 0;

        // Use document listeners to catch swipes even if target is small, 
        // but restrict to calendar view
        document.addEventListener('touchstart', function (e) {
            if (app.state.view !== 'calendar') return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, { passive: true });

        document.addEventListener('touchend', function (e) {
            if (app.state.view !== 'calendar') return;
            var diffX = e.changedTouches[0].clientX - startX;
            var diffY = e.changedTouches[0].clientY - startY;

            // horizontal swipe > 80px and horizontal more than vertical
            if (Math.abs(diffX) > 80 && Math.abs(diffX) > Math.abs(diffY)) {
                app.handlers.changeWeek(diffX > 0 ? -1 : 1);
            }
        }, { passive: true });
    },

    setupEventListeners: function () {
        document.getElementById('modal-overlay').onclick = function (e) {
            if (e.target.id === 'modal-overlay') { app.ui.closeModals(); }
        };

        const formMem = document.getElementById('form-member');
        if (formMem) formMem.onsubmit = function (e) {
            e.preventDefault(); var fd = new FormData(e.target);
            var id = fd.get('id');
            var name = fd.get('name');
            var color = fd.get('color');
            if (id) {
                app.api.updateMember(id, { name, color });
            } else {
                app.api.createEmptyMember(name, color);
            }
            app.ui.closeModals(); e.target.reset();
        };

        const formStore = document.getElementById('form-store');
        if (formStore) formStore.onsubmit = function (e) {
            e.preventDefault(); var fd = new FormData(e.target);
            var id = fd.get('id');
            if (id) {
                app.api.updateStore(id, { name: fd.get('name') });
            } else {
                app.api.createStore(fd.get('name'));
            }
            app.ui.closeModals(); e.target.reset();
        };

        const formAppt = document.getElementById('form-appointment');
        if (formAppt) {
            const rBtns = document.querySelectorAll('#repeat-freq-btns .group-btn');
            rBtns.forEach(btn => {
                btn.onclick = function () {
                    rBtns.forEach(b => b.classList.remove('active'));
                    this.classList.add('active');
                    const val = this.getAttribute('data-val');
                    if (val !== 'custom') formAppt.querySelector('[name=repeatFrequency]').value = val;
                    document.getElementById('repeat-frequency-input').style.display = (val === 'custom' ? 'block' : 'none');
                };
            });
            document.getElementById('btn-delete-appt').onclick = () => {
                const id = formAppt.querySelector('[name=id]').value;
                if (id) app.handlers.deleteAppointment();
                else app.ui.closeModals();
            };
            formAppt.onsubmit = function (e) {
                e.preventDefault(); var fd = new FormData(e.target);
                var id = fd.get('id');
                var apptData = {
                    title: fd.get('title'),
                    date: fd.get('date'),
                    time: fd.get('time'),
                    memberId: fd.get('memberId'),
                    comment: fd.get('comment'),
                    repeatType: fd.get('repeatType'),
                    repeatFrequency: parseInt(fd.get('repeatFrequency')) || 1
                };
                if (id) app.api.updateAppointment(id, apptData);
                else app.api.addAppointment(apptData);
                app.ui.closeModals(); e.target.reset();
            };
        }

        const formHead = document.getElementById('form-heading');
        if (formHead) formHead.onsubmit = function (e) {
            e.preventDefault(); var fd = new FormData(e.target);
            var name = fd.get('name');
            if (name) {
                app.api.addGroceryItem({ storeId: app.state.selectedStoreId, text: name, checked: false, isHeader: true });
                app.ui.closeModals(); e.target.reset();
            }
        };

        const formSet = document.getElementById('form-settings');
        if (formSet) formSet.onsubmit = async function (e) {
            e.preventDefault(); var fd = new FormData(e.target);
            var startHour = parseInt(fd.get('startHour'));
            var endHour = parseInt(fd.get('endHour'));

            app.state.settings.startHour = startHour;
            app.state.settings.endHour = endHour;

            // Save settings to database
            if (app.state.familyId) {
                const { error } = await supabaseClient
                    .from('families')
                    .update({
                        start_hour: startHour,
                        end_hour: endHour
                    })
                    .eq('id', app.state.familyId);

                if (error) {
                    console.error('Failed to save settings:', error);
                    alert('Failed to save settings. Check console.');
                } else {
                    console.log('✅ Settings saved successfully');
                }
            }

            app.ui.closeModals(); app.render();
        };

        const formCreateFamily = document.getElementById('form-create-family');
        if (formCreateFamily) formCreateFamily.onsubmit = async function (e) {
            e.preventDefault();
            var fd = new FormData(e.target);
            var familyName = fd.get('familyName');
            var memberName = fd.get('memberName');
            var color = fd.get('color');

            await app.api.createFamilyAndMember(familyName, memberName, color);
            app.ui.closeModals();
            e.target.reset();
        };

        const formJoinFamily = document.getElementById('form-join-family');
        if (formJoinFamily) formJoinFamily.onsubmit = async function (e) {
            e.preventDefault();
            var fd = new FormData(e.target);
            var inviteCode = fd.get('inviteCode').toUpperCase();
            var memberName = fd.get('memberName');
            var color = fd.get('color');

            await app.api.joinFamilyWithCode(inviteCode, memberName, color);
            app.ui.closeModals();
            e.target.reset();
        };

        var formEditItem = document.getElementById('form-edit-item');
        if (formEditItem) formEditItem.onsubmit = function (e) {
            e.preventDefault();
            var fd = new FormData(e.target);
            var newText = fd.get('text');

            if (newText && newText.trim() && app.state.editingItemId) {
                app.api.updateGroceryItem(app.state.editingItemId, { text: newText.trim() });
            }

            app.state.editingItemId = null;
            app.ui.closeModals();
            e.target.reset();
        };
    },
};

app.init();
