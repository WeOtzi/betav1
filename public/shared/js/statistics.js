// Statistics Page Logic

let quotations = [];
let charts = {}; // Store chart instances
let _supabase = null;

document.addEventListener('DOMContentLoaded', async () => {
    await initializeSupabase();
    await loadStatisticsData();
    setupFilters();
});

async function initializeSupabase() {
    // Try to get client from ConfigManager first
    if (window.ConfigManager && window.ConfigManager.getSupabaseClient) {
        _supabase = window.ConfigManager.getSupabaseClient();
    }
    
    // Fallback to manual initialization if ConfigManager didn't return a client
    if (!_supabase && window.supabase) {
        const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
        const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
        _supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
    }

    if (!_supabase) {
        console.error('Supabase client could not be initialized');
    }
}

async function loadStatisticsData() {
    try {
        if (!_supabase) {
            console.error('Supabase not initialized');
            return;
        }

        const { data: { session }, error: authError } = await _supabase.auth.getSession();
        
        if (authError || !session) {
            console.log('No authenticated session. Redirecting...');
            window.location.href = '/artist/dashboard'; // Redirect to dashboard or login
            return;
        }

        const user = session.user;
        document.getElementById('logged-as').textContent = `LOGGED_AS: ${user.email.split('@')[0].toUpperCase()}`;

        // Fetch all quotations for the artist
        const { data: allQuotes, error: fetchError } = await _supabase
            .from('quotations_db')
            .select('*')
            .eq('artist_id', user.id);

        if (fetchError) throw fetchError;

        quotations = allQuotes || [];
        
        updateKPIs();
        renderRevenueChart('year'); // Default view
        renderStylesChart();
        renderStatusChart();
        renderTopClientsTable();

    } catch (error) {
        console.error('Error loading statistics:', error);
        // Show error UI
    }
}

function updateKPIs() {
    // 1. Total Revenue (Completed quotes using final_budget_amount)
    const completedQuotes = quotations.filter(q => q.quote_status === 'completed');
    const totalRevenue = completedQuotes.reduce((sum, q) => sum + (parseFloat(q.final_budget_amount) || 0), 0);
    
    // 2. Total Quotes (All time)
    const totalQuotes = quotations.length;

    // 3. Conversion Rate (Completed / Total)
    const conversionRate = totalQuotes > 0 ? ((completedQuotes.length / totalQuotes) * 100).toFixed(1) : 0;

    // 4. Avg Ticket Size
    const avgTicket = completedQuotes.length > 0 ? (totalRevenue / completedQuotes.length).toFixed(0) : 0;

    // Update DOM
    document.getElementById('kpi-revenue').textContent = formatCurrency(totalRevenue);
    document.getElementById('kpi-quotes').textContent = totalQuotes;
    document.getElementById('kpi-conversion').textContent = `${conversionRate}%`;
    document.getElementById('kpi-avg-ticket').textContent = formatCurrency(avgTicket);
}

function renderRevenueChart(period) {
    const ctx = document.getElementById('revenueChart').getContext('2d');
    
    // Group data by month
    const monthlyData = {};
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Initialize current year months
    const currentYear = new Date().getFullYear();
    months.forEach((m, i) => monthlyData[i] = 0);

    quotations.forEach(q => {
        if (q.quote_status === 'completed') {
            const date = new Date(q.created_at); // Or completed_at if available? using created_at for now as proxy or need to check schema
            if (date.getFullYear() === currentYear) {
                monthlyData[date.getMonth()] += (parseFloat(q.final_budget_amount) || 0);
            }
        }
    });

    const data = Object.values(monthlyData);

    if (charts.revenue) charts.revenue.destroy();

    charts.revenue = new Chart(ctx, {
        type: 'line',
        data: {
            labels: months,
            datasets: [{
                label: `Revenue ${currentYear}`,
                data: data,
                borderColor: '#457B9D', // Bauhaus Blue
                backgroundColor: 'rgba(69, 123, 157, 0.1)',
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#457B9D',
                pointRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return formatCurrency(context.raw);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { borderDash: [5, 5] },
                    ticks: {
                        callback: function(value) {
                            return '$' + value;
                        }
                    }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

function renderStylesChart() {
    const ctx = document.getElementById('stylesChart').getContext('2d');
    
    // Count styles
    const styleCounts = {};
    quotations.forEach(q => {
        // Handle tattoo_style as object or string depending on schema
        let style = 'Unknown';
        if (q.tattoo_style) {
            if (typeof q.tattoo_style === 'object' && q.tattoo_style.style_name) {
                style = q.tattoo_style.style_name;
            } else if (typeof q.tattoo_style === 'string') {
                // Try parsing if it's a JSON string
                try {
                    const parsed = JSON.parse(q.tattoo_style);
                    style = parsed.style_name || q.tattoo_style;
                } catch (e) {
                    style = q.tattoo_style;
                }
            }
        }
        styleCounts[style] = (styleCounts[style] || 0) + 1;
    });

    // Sort and take top 5
    const sortedStyles = Object.entries(styleCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    if (charts.styles) charts.styles.destroy();

    charts.styles = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: sortedStyles.map(s => s[0]),
            datasets: [{
                data: sortedStyles.map(s => s[1]),
                backgroundColor: [
                    '#E63946', // Red
                    '#457B9D', // Blue
                    '#F4D03F', // Yellow
                    '#1D3557', // Dark Blue
                    '#A8DADC'  // Light Blue
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        font: { family: "'Space Mono', monospace" }
                    }
                }
            }
        }
    });
}

function renderStatusChart() {
    const ctx = document.getElementById('statusChart').getContext('2d');
    
    const statusCounts = {
        pending: 0,
        responded: 0,
        completed: 0,
        other: 0
    };

    quotations.forEach(q => {
        const status = q.quote_status || 'other';
        if (statusCounts.hasOwnProperty(status)) {
            statusCounts[status]++;
        } else {
            statusCounts.other++;
        }
    });

    if (charts.status) charts.status.destroy();

    charts.status = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Pending', 'Responded', 'Completed', 'Other'],
            datasets: [{
                label: 'Quotations',
                data: [statusCounts.pending, statusCounts.responded, statusCounts.completed, statusCounts.other],
                backgroundColor: [
                    '#F4D03F', // Pending (Yellow)
                    '#457B9D', // Responded (Blue)
                    '#27ae60', // Completed (Green)
                    '#95a5a6'  // Other (Grey)
                ],
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderTopClientsTable() {
    const tbody = document.getElementById('top-clients-body');
    tbody.innerHTML = '';

    // Group by client name (simple approach, ideally use client_id if available)
    const clientStats = {};
    quotations.forEach(q => {
        const name = q.client_full_name || 'Unknown';
        if (!clientStats[name]) {
            clientStats[name] = { count: 0, revenue: 0, lastDate: null };
        }
        clientStats[name].count++;
        if (q.quote_status === 'completed') {
            clientStats[name].revenue += (parseFloat(q.final_budget_amount) || 0);
        }
        const qDate = new Date(q.created_at);
        if (!clientStats[name].lastDate || qDate > clientStats[name].lastDate) {
            clientStats[name].lastDate = qDate;
        }
    });

    // Convert to array and sort by revenue
    const sortedClients = Object.entries(clientStats)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 10);

    sortedClients.forEach(([name, stats]) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${name}</td>
            <td>${stats.count}</td>
            <td>${formatCurrency(stats.revenue)}</td>
            <td>${stats.lastDate ? stats.lastDate.toLocaleDateString() : '-'}</td>
        `;
        tbody.appendChild(tr);
    });
}

function setupFilters() {
    const rangeSelect = document.getElementById('time-range-select');
    if (rangeSelect) {
        rangeSelect.addEventListener('change', (e) => {
            // Implement filtering logic here
            // For now, just re-render charts (mock refresh)
            console.log('Filter changed:', e.target.value);
            // In a real implementation, we'd filter the 'quotations' array passed to render functions
        });
    }
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD', // Or dynamic based on user settings
        minimumFractionDigits: 0
    }).format(amount);
}
