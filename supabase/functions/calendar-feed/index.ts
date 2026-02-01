import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const url = new URL(req.url)
        const familyId = url.searchParams.get('id')

        if (!familyId) {
            return new Response('Missing family ID', { status: 400 })
        }

        // Initialize Supabase client
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // Fetch family and appointments
        const { data: family, error: familyError } = await supabase
            .from('families')
            .select('name')
            .eq('id', familyId)
            .single()

        if (familyError || !family) {
            return new Response('Family not found', { status: 404 })
        }

        const { data: appointments, error: appointmentsError } = await supabase
            .from('appointments')
            .select('*')
            .eq('family_id', familyId)

        if (appointmentsError) {
            return new Response('Error fetching appointments', { status: 500 })
        }

        // Generate iCalendar content
        let ical = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Family Calendar//EN',
            'X-WR-CALNAME:' + (family.name || 'Family Calendar'),
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH'
        ]

        appointments.forEach(appt => {
            const timeParts = appt.time.split(':')
            const hour = timeParts[0].padStart(2, '0')
            const minute = (timeParts[1] || '00').padStart(2, '0')
            const startStr = appt.date.replace(/-/g, '') + 'T' + hour + minute + '00'

            // Assume 1 hour duration if not specified
            const endHourNum = parseInt(hour) + 1
            const endHour = endHourNum.toString().padStart(2, '0')
            const endStr = appt.date.replace(/-/g, '') + 'T' + endHour + minute + '00'

            ical.push('BEGIN:VEVENT')
            ical.push('UID:' + appt.id + '@familycalendar.supabase')
            ical.push('DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z')
            ical.push('DTSTART:' + startStr)
            ical.push('DTEND:' + endStr)
            ical.push('SUMMARY:' + appt.title)
            if (appt.comment) ical.push('DESCRIPTION:' + appt.comment)

            // Handle repetition if needed
            if (appt.repeat_type && appt.repeat_type !== 'none') {
                const freq = appt.repeat_type.toUpperCase()
                const interval = appt.repeat_frequency || 1
                ical.push(`RRULE:FREQ=${freq};INTERVAL=${interval}`)
            }

            ical.push('END:VEVENT')
        })

        ical.push('END:VCALENDAR')

        return new Response(ical.join('\r\n'), {
            headers: {
                ...corsHeaders,
                'Content-Type': 'text/calendar; charset=utf-8',
                'Content-Disposition': 'attachment; filename="calendar.ics"',
            },
        })
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        })
    }
})
