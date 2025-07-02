import React, { useState, useEffect } from 'react';
import { StyleSheet, FlatList, Alert, Platform, Button } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import JSZip from 'jszip';
import { initDatabase, storeVoiceNote } from '../config/supabase';
import { Link } from 'expo-router';

interface JSZipObject {
  async(type: 'string' | 'base64'): Promise<string>;
  name: string;
}

interface JSZipFile {
  files: { [key: string]: JSZipObject };
}

import { ThemedView } from './ThemedView';
import { ThemedText } from './ThemedText';

interface VoiceNote {
  id: string;
  path: string;
  timestamp: string;
}

interface Conversation {
  id: string;
  name: string;
  selected: boolean;
  voiceNotes: VoiceNote[];
}

export const ConversationSelector = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentZip, setCurrentZip] = useState<JSZipFile | null>(null);

  useEffect(() => {
    // Initialize Supabase when component mounts
    const setup = async () => {
      try {
        await initDatabase();
      } catch (error) {
        console.error('Failed to initialize Supabase:', error);
        Alert.alert('Database Error', 'Could not connect to Supabase. Please check your connection settings.');
      }
    };

    setup();
  }, []);

  const handleWhatsAppExport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/zip",
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      setIsLoading(true);

      // Get the path of the selected file
      const uri = result.assets[0].uri;

      // Read the zip file as binary data
      const zipData = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64
      });

      // Load the zip file
      const zip = new JSZip();
      const loadedZip = await zip.loadAsync(zipData, { base64: true }) as JSZipFile;
      setCurrentZip(loadedZip);

      // Process the contents
      const exportedConversations: Conversation[] = [];
      let currentChat: Conversation | null = null;

      // First, find the chat text file
      const chatFiles = Object.values(loadedZip.files).filter(file =>
        file.name.endsWith('_chat.txt') || file.name.endsWith('.txt')
      );

      for (const chatFile of chatFiles) {
        const content = await chatFile.async('string');
        const lines = content.split('\n');

        // Extract chat name from the first message (usually the encryption notice)
        const firstLine = lines[0];
        const nameMatch = firstLine.match(/\] ([^:]+):/);
        const chatName = nameMatch ? nameMatch[1] : 'Unknown Chat';

        currentChat = {
          id: String(exportedConversations.length + 1),
          name: chatName,
          selected: false,
          voiceNotes: []
        };

        // Process each line to find voice notes
        for (const line of lines) {
          if (line.includes('<attached: ') && line.includes('-AUDIO-') && line.includes('.opus>')) {
            const audioMatch = line.match(/(\d+-AUDIO-[^>]+\.opus)/);
            if (audioMatch) {
              const audioFileName = audioMatch[1];
              // Extract timestamp from the line
              const timestampMatch = line.match(/\[([\d/]+,\s*[\d:]+\s*[APM]+)\]/);
              const timestamp = timestampMatch ? timestampMatch[1] : '';

              currentChat.voiceNotes.push({
                id: audioFileName,
                path: audioFileName,
                timestamp
              });
            }
          }
        }

        if (currentChat.voiceNotes.length > 0) {
          exportedConversations.push(currentChat);
        }
      }

      if (exportedConversations.length > 0) {
        setConversations(exportedConversations);
        Alert.alert('Success', `Found ${exportedConversations.reduce((sum, conv) => sum + conv.voiceNotes.length, 0)} voice notes in ${exportedConversations.length} conversations`);
      } else {
        Alert.alert('No Voice Notes', 'No voice notes found in the exported chat');
      }
    } catch (error: any) {
      console.error('Error processing zip:', error);
      Alert.alert('Error', 'Failed to process WhatsApp export. Make sure you selected a valid WhatsApp chat export file.');
    } finally {
      setIsLoading(false);
    }
  };

  const exportVoiceNotes = async () => {
    if (!currentZip) {
      Alert.alert('Error', 'Please import the WhatsApp export file again');
      return;
    }

    const selectedConversations = conversations.filter(conv => conv.selected);
    if (selectedConversations.length === 0) {
      Alert.alert('Error', 'Please select at least one conversation');
      return;
    }

    try {
      setIsLoading(true);

      // Export voice notes from selected conversations
      let exportedCount = 0;
      for (const conv of selectedConversations) {
        for (const note of conv.voiceNotes) {
          try {
            // Find the audio file in the zip
            const audioFile = Object.values(currentZip.files).find(file =>
              file.name === note.path || file.name.endsWith('/' + note.path)
            );

            if (!audioFile) {
              console.warn(`Audio file not found in zip: ${note.path}`);
              continue;
            }

            // Extract the audio file content as base64
            const audioContent = await audioFile.async('base64');

            // Parse date string from timestamp (format: [MM/DD/YY, HH:MM:SS AM/PM])
            let parsedDate = new Date();
            try {
              const timestamp = note.timestamp.replace(/[\[\]]/g, '');
              const [datePart, timePart] = timestamp.split(', ');
              if (datePart && timePart) {
                const [month, day, year] = datePart.split('/').map(n => parseInt(n));
                let [time, period] = timePart.split(' ');
                let [hours, minutes, seconds] = time.split(':').map(n => parseInt(n));

                if (period === 'PM' && hours < 12) hours += 12;
                if (period === 'AM' && hours === 12) hours = 0;

                parsedDate = new Date(2000 + year, month - 1, day, hours, minutes, seconds);
              }
            } catch (err) {
              console.warn('Failed to parse timestamp:', note.timestamp);
            }

            // Store in Supabase
            await storeVoiceNote(
              note.path,
              conv.name,
              parsedDate.toISOString(),
              audioContent
            );

            exportedCount++;
          } catch (err) {
            console.warn(`Failed to export voice note: ${note.path}`, err);
          }
        }
      }

      if (exportedCount > 0) {
        Alert.alert('Success', `Exported ${exportedCount} voice notes successfully to Supabase`);
      } else {
        Alert.alert('Error', 'No voice notes could be exported. Please try importing the chat export again.');
      }
    } catch (error: any) {
      console.error('Export error:', error);
      Alert.alert('Error', 'Failed to export voice notes. Please check your Supabase connection.');
    } finally {
      setIsLoading(false);
    }
  };

  const importWhatsAppData = async () => {
    await handleWhatsAppExport();
  };

  const toggleConversation = (id: string) => {
    setConversations(conversations.map(conv =>
      conv.id === id ? { ...conv, selected: !conv.selected } : conv
    ));
  };

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title" style={styles.title}>
        WhatsApp Voice Notes Export
      </ThemedText>

      {Platform.OS === 'android' && (
        <ThemedView style={styles.buttonContainer}>
          <Link href="/android-direct-access" asChild>
            <Button
              title="Try Direct Access (Android Only)"
              color="#ff5c5c" // A different color to distinguish it
            />
          </Link>
        </ThemedView>
      )}

      <ThemedView style={styles.buttonContainer}>
        <ThemedText
          type="defaultSemiBold"
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={importWhatsAppData}>
          {isLoading ? 'Processing...' : 'Import WhatsApp Export'}
        </ThemedText>
      </ThemedView>

      {conversations.length > 0 && (
        <>
          <ThemedText type="subtitle" style={styles.subtitle}>
            Select Conversations to Export
          </ThemedText>

          <FlatList
            data={conversations}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ThemedView
                style={[
                  styles.conversationItem,
                  item.selected && styles.selectedItem
                ]}>
                <ThemedText
                  onPress={() => toggleConversation(item.id)}
                  style={styles.conversationText}>
                  {item.name}
                  {item.voiceNotes.length > 0 && ` 🎤 (${item.voiceNotes.length})`}
                </ThemedText>
                {item.selected && (
                  <FlatList
                    data={item.voiceNotes}
                    keyExtractor={(note) => note.id}
                    renderItem={({ item: note }) => (
                      <ThemedText style={styles.voiceNoteItem}>
                        📅 {note.timestamp} - 🎤 {note.path}
                      </ThemedText>
                    )}
                  />
                )}
              </ThemedView>
            )}
          />

          <ThemedView style={styles.buttonContainer}>
            <ThemedText
              type="defaultSemiBold"
              style={[styles.button, isLoading && styles.buttonDisabled]}
              onPress={exportVoiceNotes}>
              {isLoading ? 'Processing...' : 'Export Voice Notes to Supabase'}
            </ThemedText>
          </ThemedView>
        </>
      )}

      <ThemedText style={styles.instructions}>
        Instructions:{'\n'}
        1. For the most reliable method, use the "Import WhatsApp Export" button.{'\n'}
        2. In WhatsApp, open a chat{'\n'}
        3. Tap the contact name at the top{'\n'}
        4. Scroll down and tap "Export Chat"{'\n'}
        5. Choose "Include Media" and select the exported .zip file.
      </ThemedText>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    marginBottom: 20,
    textAlign: 'center',
  },
  subtitle: {
    marginVertical: 10,
  },
  buttonContainer: {
    alignItems: 'center',
    marginVertical: 5,
  },
  button: {
    backgroundColor: '#25D366', // WhatsApp green
    color: '#fff',
    padding: 12,
    borderRadius: 8,
    overflow: 'hidden',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  conversationItem: {
    padding: 12,
    borderRadius: 8,
    marginVertical: 4,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  selectedItem: {
    backgroundColor: 'rgba(37, 211, 102, 0.1)', // Light WhatsApp green
  },
  conversationText: {
    fontSize: 16,
    marginBottom: 8,
  },
  voiceNoteItem: {
    fontSize: 12,
    color: '#666',
    marginLeft: 16,
    marginTop: 4,
  },
  instructions: {
    marginTop: 20,
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
}); 