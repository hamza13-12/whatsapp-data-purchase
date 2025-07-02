import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { Alert } from 'react-native';

// Get Supabase URL and Key from environment variables
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// Display warning if environment variables are not set
if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
        'Supabase URL or Key not found. Please set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file.'
    );
}

// Create Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
    },
});

// Initialize database by ensuring the table exists
export const initDatabase = async () => {
    try {
        // Just check if we can connect
        const { error } = await supabase.from('whatsapp_voice_notes').select('id').limit(1);

        if (error) {
            console.error('Error initializing Supabase:', error.message);
            // Provide a more helpful error message if the table is not found
            if (error.message.includes('relation "whatsapp_voice_notes" does not exist')) {
                Alert.alert('Database Error', 'The "whatsapp_voice_notes" table was not found. Please ensure you have created it in your Supabase dashboard.');
            }
            throw error;
        }

        console.log('Supabase connection successful');
        return true;
    } catch (error) {
        console.error('Caught error during Supabase initialization:', error);
        throw error;
    }
};

// Store a voice note in Supabase
export const storeVoiceNote = async (
    fileName: string,
    chatName: string,
    timestamp: string,
    fileContent: string
) => {
    try {
        // Insert the record
        const { data, error } = await supabase.from('whatsapp_voice_notes').insert([
            {
                file_name: fileName,
                chat_name: chatName,
                timestamp: timestamp,
                file_content: fileContent,
            },
        ]);

        if (error) {
            console.error('Error storing voice note:', error);
            throw error;
        }

        return data;
    } catch (error) {
        console.error('Error storing voice note:', error);
        throw error;
    }
};

// Get all voice notes
export const getVoiceNotes = async () => {
    const { data, error } = await supabase
        .from('whatsapp_voice_notes')
        .select('*')
        .order('timestamp', { ascending: false });

    if (error) {
        console.error('Error fetching voice notes:', error);
        throw error;
    }

    return data;
};

// Get voice notes by chat name
export const getVoiceNotesByChatName = async (chatName: string) => {
    const { data, error } = await supabase
        .from('whatsapp_voice_notes')
        .select('*')
        .eq('chat_name', chatName)
        .order('timestamp', { ascending: false });

    if (error) {
        console.error('Error fetching voice notes by chat name:', error);
        throw error;
    }

    return data;
}; 