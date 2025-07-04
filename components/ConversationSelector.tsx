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

  const debugZipContents = async (loadedZip: JSZipFile) => {
    console.log('=== ZIP CONTENTS DEBUG ===');
    const allFiles = Object.keys(loadedZip.files);
    console.log('Total files in zip:', allFiles.length);

    allFiles.forEach((fileName, index) => {
      console.log(`${index + 1}. ${fileName}`);
    });

    // Look for text files
    const textFiles = allFiles.filter(name => name.endsWith('.txt'));
    console.log('Text files found:', textFiles);

    // Look for audio files
    const audioFiles = allFiles.filter(name =>
      name.includes('.opus') ||
      name.includes('.m4a') ||
      name.includes('.aac') ||
      name.includes('.mp3') ||
      name.includes('PTT-') // WhatsApp voice message prefix
    );
    console.log('Audio files found:', audioFiles);

    // Check if files are in subdirectories
    const hasSubdirs = allFiles.some(name => name.includes('/'));
    console.log('Has subdirectories:', hasSubdirs);

    if (hasSubdirs) {
      const dirs = [...new Set(allFiles.map(name => name.split('/')[0]).filter(dir => dir))];
      console.log('Subdirectories:', dirs);
    }

    return { textFiles, audioFiles, allFiles };
  };

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

      // DEBUG: Log zip contents
      const { textFiles, audioFiles, allFiles } = await debugZipContents(loadedZip);

      // Process the contents
      const exportedConversations: Conversation[] = [];

      // look for various patterns
      const possibleChatFiles = allFiles.filter(fileName => {
        const lowerName = fileName.toLowerCase();
        return lowerName.endsWith('.txt') ||
          lowerName.includes('chat') ||
          lowerName.includes('whatsapp');
      });

      console.log('Possible chat files:', possibleChatFiles);

      if (possibleChatFiles.length === 0) {
        Alert.alert('Debug Info', `No chat files found. All files: ${allFiles.slice(0, 10).join(', ')}${allFiles.length > 10 ? '...' : ''}`);
        return;
      }

      for (const chatFileName of possibleChatFiles) {
        try {
          const chatFile = loadedZip.files[chatFileName];
          if (!chatFile) {
            console.log(`Chat file not found: ${chatFileName}`);
            continue;
          }

          const content = await chatFile.async('string');
          const lines = content.split('\n').filter(line => line.trim());

          console.log(`Processing chat file: ${chatFileName}`);
          console.log(`Total lines: ${lines.length}`);
          console.log(`First 3 lines:`, lines.slice(0, 3));

          // name extraction
          let chatName = 'Unknown Chat';

          // Try different patterns to extract chat name
          for (let i = 0; i < Math.min(10, lines.length); i++) {
            const line = lines[i];

            // Pattern 1: WhatsApp format with encryption notice
            let nameMatch = line.match(/\] ([^:]+):/);
            if (nameMatch && !nameMatch[1].includes('WhatsApp') && !nameMatch[1].includes('Messages')) {
              chatName = nameMatch[1];
              break;
            }

            // Pattern 2: Group chat format
            nameMatch = line.match(/\] ([^:]+) created group/);
            if (nameMatch) {
              chatName = nameMatch[1];
              break;
            }

            // Pattern 3: Extract from filename
            if (chatFileName.includes('WhatsApp Chat with ')) {
              chatName = chatFileName.replace('WhatsApp Chat with ', '').replace('.txt', '');
              break;
            }

            // Pattern 4: Extract from filename (alternative format)
            if (chatFileName.includes('_chat')) {
              chatName = chatFileName.replace('_chat.txt', '').replace(/_/g, ' ');
              break;
            }
          }

          const currentChat: Conversation = {
            id: String(exportedConversations.length + 1),
            name: chatName,
            selected: false,
            voiceNotes: []
          };

          // Enhanced voice note detection with multiple patterns
          let voiceNotesFound = 0;

          for (const line of lines) {
            let audioFileName = '';
            let timestamp = '';

            // Extract timestamp first (common pattern)
            const timestampMatch = line.match(/\[([\d/]+,\s*[\d:]+\s*[APM]*)\]/);
            timestamp = timestampMatch ? timestampMatch[1] : '';

            // Pattern 1: iOS format - <attached: filename-AUDIO-xxx.opus>
            if (line.includes('<attached:') && line.includes('-AUDIO-') && line.includes('.opus')) {
              const audioMatch = line.match(/(\d+-AUDIO-[^>]+\.opus)/);
              if (audioMatch) {
                audioFileName = audioMatch[1];
              }
            }

            // Pattern 2: Android format - <attached: PTT-xxxxxxxx-WAxxxx.opus>
            else if (line.includes('<attached:') && line.includes('PTT-') && line.includes('.opus')) {
              const audioMatch = line.match(/PTT-[^>]+\.opus/);
              if (audioMatch) {
                audioFileName = audioMatch[0];
              }
            }

            // Pattern 3: General attached audio files
            else if (line.includes('<attached:') && (line.includes('.opus') || line.includes('.m4a') || line.includes('.aac'))) {
              const audioMatch = line.match(/<attached:\s*([^>]+\.(opus|m4a|aac))/i);
              if (audioMatch) {
                audioFileName = audioMatch[1].trim();
              }
            }

            // Pattern 4: Voice message indicators without <attached:>
            else if (line.includes('voice message') || line.includes('audio message')) {
              // Try to find corresponding audio file by timestamp or position
              const potentialAudioFile = audioFiles.find(file => {
                const fileBaseName = file.split('/').pop() || '';
                return fileBaseName.includes('PTT-') || fileBaseName.includes('AUDIO-');
              });

              if (potentialAudioFile) {
                audioFileName = potentialAudioFile.split('/').pop() || potentialAudioFile;
              }
            }

            // Pattern 5: Direct filename reference in line
            else if (line.match(/PTT-[^>\s]+\.opus/)) {
              const audioMatch = line.match(/PTT-[^>\s]+\.opus/);
              if (audioMatch) {
                audioFileName = audioMatch[0];
              }
            }

            if (audioFileName) {
              // Check if this audio file actually exists in the zip
              const audioFileExists = audioFiles.some(file =>
                file.includes(audioFileName) ||
                file.endsWith(audioFileName) ||
                audioFileName.includes(file.split('/').pop() || '')
              );

              if (audioFileExists || true) { // Allow even if not found for debugging
                currentChat.voiceNotes.push({
                  id: audioFileName,
                  path: audioFileName,
                  timestamp: timestamp || 'No timestamp'
                });
                voiceNotesFound++;
              }
            }
          }

          console.log(`Voice notes found in ${chatFileName}: ${voiceNotesFound}`);

          if (currentChat.voiceNotes.length > 0) {
            exportedConversations.push(currentChat);
          }

        } catch (fileError) {
          console.error(`Error processing chat file ${chatFileName}:`, fileError);
        }
      }

      if (exportedConversations.length > 0) {
        const totalVoiceNotes = exportedConversations.reduce((sum, conv) => sum + conv.voiceNotes.length, 0);
        setConversations(exportedConversations);
        Alert.alert('Success', `Found ${totalVoiceNotes} voice notes in ${exportedConversations.length} conversations`);
      } else {
        // Enhanced debug info
        const debugInfo = `
Total files: ${allFiles.length}
Text files: ${textFiles.length}
Audio files: ${audioFiles.length}
Sample text files: ${possibleChatFiles.slice(0, 3).join(', ')}
Sample audio files: ${audioFiles.slice(0, 3).join(', ')}
        `.trim();

        Alert.alert('Debug Info', debugInfo);
        console.log('No voice notes found. Full file list:', allFiles);
      }

    } catch (error: any) {
      console.error('Error processing zip:', error);
      Alert.alert('Error', `Failed to process WhatsApp export: ${error.message}`);
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
      let notFoundCount = 0;

      for (const conv of selectedConversations) {
        for (const note of conv.voiceNotes) {
          try {
            // Enhanced audio file search - try multiple patterns
            let audioFile = null;

            // Try exact match first
            audioFile = Object.values(currentZip.files).find(file =>
              file.name === note.path
            );

            // Try with path variations
            if (!audioFile) {
              audioFile = Object.values(currentZip.files).find(file =>
                file.name.endsWith('/' + note.path) ||
                file.name.includes(note.path) ||
                note.path.includes(file.name.split('/').pop() || '')
              );
            }

            // Try matching audio files by pattern
            if (!audioFile) {
              audioFile = Object.values(currentZip.files).find(file => {
                const fileName = file.name.split('/').pop() || '';
                return fileName.includes('PTT-') || fileName.includes('AUDIO-') || fileName.includes('.opus');
              });
            }

            if (!audioFile) {
              console.warn(`Audio file not found in zip: ${note.path}`);
              notFoundCount++;
              continue;
            }

            console.log(`Found audio file: ${audioFile.name} for note: ${note.path}`);

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
              audioFile.name,
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
        Alert.alert('Success', `Exported ${exportedCount} voice notes successfully to Supabase${notFoundCount > 0 ? `\n(${notFoundCount} files not found)` : ''}`);
      } else {
        Alert.alert('Error', `No voice notes could be exported. ${notFoundCount} files not found in zip.`);
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
        5. Choose "Include Media" and select the exported .zip file.{'\n'}
        6. Check console/logs for detailed debug information if issues occur.
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