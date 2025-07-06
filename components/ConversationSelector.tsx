import React, { useState, useEffect } from 'react';
import { StyleSheet, FlatList, Alert, Platform, Button } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { initDatabase, storeVoiceNote } from '../config/supabase';
import { Link } from 'expo-router';

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
  const [extractedPath, setExtractedPath] = useState<string | null>(null);

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

  const ensureDirectoryExists = async (path: string) => {
    try {
      const exists = await RNFS.exists(path);
      if (!exists) {
        await RNFS.mkdir(path);
      }
    } catch (error) {
      console.error('Error creating directory:', error);
      throw error;
    }
  };

  const copyFileToInternalStorage = async (sourceUri: string): Promise<string> => {
    try {
      // Create a temporary directory in the app's internal storage
      const tempDir = `${RNFS.DocumentDirectoryPath}/temp_whatsapp`;
      await ensureDirectoryExists(tempDir);
      
      // Generate a unique filename for the ZIP
      const timestamp = Date.now();
      const targetPath = `${tempDir}/whatsapp_export_${timestamp}.zip`;
      
      // Copy the file to internal storage
      console.log('Copying file from:', sourceUri);
      console.log('Copying file to:', targetPath);
      
      // Use RNFS to copy the file
      await RNFS.copyFile(sourceUri, targetPath);
      
      // Verify the file was copied
      const exists = await RNFS.exists(targetPath);
      if (!exists) {
        throw new Error('Failed to copy file to internal storage');
      }
      
      const stats = await RNFS.stat(targetPath);
      console.log('File copied successfully, size:', stats.size);
      
      return targetPath;
    } catch (error) {
      console.error('Error copying file:', error);
      throw error;
    }
  };

  const extractZipFile = async (zipPath: string): Promise<string> => {
    try {
      // Create extraction directory
      const extractDir = `${RNFS.DocumentDirectoryPath}/whatsapp_extracted`;
      await ensureDirectoryExists(extractDir);
      
      // Clean up any existing extraction
      const existingFiles = await RNFS.readDir(extractDir);
      for (const file of existingFiles) {
        await RNFS.unlink(file.path);
      }
      
      console.log('Extracting ZIP to:', extractDir);
      
      // Extract the ZIP file
      await unzip(zipPath, extractDir);
      
      console.log('ZIP extraction completed');
      return extractDir;
    } catch (error) {
      console.error('Error extracting ZIP:', error);
      throw error;
    }
  };

  const scanDirectoryForFiles = async (dirPath: string): Promise<{ textFiles: string[], audioFiles: string[] }> => {
    const textFiles: string[] = [];
    const audioFiles: string[] = [];
    
    const scanRecursively = async (path: string) => {
      try {
        const items = await RNFS.readDir(path);
        
        for (const item of items) {
          if (item.isDirectory()) {
            await scanRecursively(item.path);
          } else {
            const fileName = item.name.toLowerCase();
            const fullPath = item.path;
            
            if (fileName.endsWith('.txt')) {
              textFiles.push(fullPath);
            } else if (fileName.includes('.opus') || fileName.includes('.m4a') || 
                      fileName.includes('.aac') || fileName.includes('.mp3') || 
                      fileName.includes('ptt-')) {
              audioFiles.push(fullPath);
            }
          }
        }
      } catch (error) {
        console.error('Error scanning directory:', path, error);
      }
    };
    
    await scanRecursively(dirPath);
    return { textFiles, audioFiles };
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
      console.log('Selected file:', result.assets[0].uri);

      // Step 1: Copy file to internal storage
      const internalZipPath = await copyFileToInternalStorage(result.assets[0].uri);
      
      // Step 2: Extract the ZIP file
      const extractedDir = await extractZipFile(internalZipPath);
      setExtractedPath(extractedDir);
      
      // Step 3: Scan for files
      const { textFiles, audioFiles } = await scanDirectoryForFiles(extractedDir);
      
      console.log('Found text files:', textFiles.length);
      console.log('Found audio files:', audioFiles.length);
      
      if (textFiles.length === 0) {
        Alert.alert('No Chat Files', 'No text files found in the WhatsApp export. Please ensure you exported with "Include Media" option.');
        return;
      }

      // Step 4: Create conversations based on found audio files
      const exportedConversations: Conversation[] = [];

      if (audioFiles.length > 0) {
        // Extract chat name from text file if available
        let chatName = 'WhatsApp Voice Notes';
        
        if (textFiles.length > 0) {
          const firstTextFile = textFiles[0];
          const fileName = firstTextFile.split('/').pop() || '';
          
          if (fileName.includes('WhatsApp Chat with ')) {
            chatName = fileName.replace('WhatsApp Chat with ', '').replace('.txt', '');
          } else if (fileName.includes('_chat')) {
            chatName = fileName.replace('_chat.txt', '').replace(/_/g, ' ');
          }
        }

        const currentChat: Conversation = {
          id: '1',
          name: chatName,
          selected: true, // Auto-select since we found audio files
          voiceNotes: []
        };

        // Add all found audio files as voice notes
        audioFiles.forEach((audioPath, index) => {
          const fileName = audioPath.split('/').pop() || '';
          
          // Try to extract timestamp from filename if it contains date info
          let timestamp = 'No timestamp';
          const timestampMatch = fileName.match(/(\d{8})-(\d{6})/); // YYYYMMDD-HHMMSS format
          if (timestampMatch) {
            const dateStr = timestampMatch[1];
            const timeStr = timestampMatch[2];
            timestamp = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)} ${timeStr.slice(0,2)}:${timeStr.slice(2,4)}:${timeStr.slice(4,6)}`;
          }

          currentChat.voiceNotes.push({
            id: `voice_note_${index + 1}`,
            path: audioPath,
            timestamp: timestamp
          });
        });

        exportedConversations.push(currentChat);
        setConversations(exportedConversations);
        Alert.alert('Success', `Found ${audioFiles.length} voice notes ready for export!`);
      } else {
        Alert.alert('No Audio Files Found', `Processed ${textFiles.length} text files but found no audio files in the WhatsApp export.`);
      }

    } catch (error: any) {
      console.error('Error processing zip:', error);
      Alert.alert('Error', `Failed to process WhatsApp export: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const exportVoiceNotes = async () => {
    if (!extractedPath) {
      Alert.alert('Error', 'Please import the WhatsApp export file first');
      return;
    }

    const selectedConversations = conversations.filter(conv => conv.selected);
    if (selectedConversations.length === 0) {
      Alert.alert('Error', 'Please select at least one conversation');
      return;
    }

    try {
      setIsLoading(true);
      let exportedCount = 0;
      let failedCount = 0;

      for (const conv of selectedConversations) {
        for (const note of conv.voiceNotes) {
          try {
            console.log('Exporting voice note:', note.path);
            
            // Check if file exists
            const exists = await RNFS.exists(note.path);
            if (!exists) {
              console.warn(`File not found: ${note.path}`);
              failedCount++;
              continue;
            }

            // Read the audio file as base64
            const audioContent = await RNFS.readFile(note.path, 'base64');
            
            // Parse timestamp
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

                parsedDate = new Date(2000 + year, month - 1, day, hours, minutes, seconds || 0);
              }
            } catch (err) {
              console.warn('Failed to parse timestamp:', note.timestamp);
            }

            // Store in Supabase
            await storeVoiceNote(
              note.id,
              conv.name,
              parsedDate.toISOString(),
              audioContent
            );

            exportedCount++;
          } catch (err) {
            console.error(`Failed to export voice note: ${note.path}`, err);
            failedCount++;
          }
        }
      }

      if (exportedCount > 0) {
        Alert.alert('Success', `Exported ${exportedCount} voice notes successfully${failedCount > 0 ? `\n(${failedCount} failed)` : ''}`);
      } else {
        Alert.alert('Error', `Failed to export any voice notes. ${failedCount} files could not be processed.`);
      }
    } catch (error: any) {
      console.error('Export error:', error);
      Alert.alert('Error', 'Failed to export voice notes. Please check your Supabase connection.');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleConversation = (id: string) => {
    setConversations(conversations.map(conv =>
      conv.id === id ? { ...conv, selected: !conv.selected } : conv
    ));
  };

  const cleanupExtractedFiles = async () => {
    if (extractedPath) {
      try {
        await RNFS.unlink(extractedPath);
        setExtractedPath(null);
        console.log('Cleaned up extracted files');
      } catch (error) {
        console.error('Error cleaning up:', error);
      }
    }
  };

  useEffect(() => {
    // Cleanup when component unmounts
    return () => {
      cleanupExtractedFiles();
    };
  }, []);

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
              color="#ff5c5c"
            />
          </Link>
        </ThemedView>
      )}

      <ThemedView style={styles.buttonContainer}>
        <ThemedText
          type="defaultSemiBold"
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleWhatsAppExport}>
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
                        📅 {note.timestamp} - 🎤 {note.path.split('/').pop()}
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
        1. In WhatsApp, open a chat{'\n'}
        2. Tap the contact name at the top{'\n'}
        3. Scroll down and tap "Export Chat"{'\n'}
        4. Choose "Include Media" and select the exported .zip file{'\n'}
        5. The app will extract and process the files automatically{'\n'}
        6. Check console logs for detailed debugging information
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
    backgroundColor: '#25D366',
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
    backgroundColor: 'rgba(37, 211, 102, 0.1)',
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