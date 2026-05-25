// ========================================
// GLOBAL ERROR HANDLING UTILITIES
// ========================================
// Maps PostgreSQL error codes to user-friendly messages
// Handles database constraints and validation errors

export interface DatabaseError {
  code?: string
  message: string
  details?: string
  hint?: string
}

export interface ErrorMapping {
  [code: string]: {
    message: string
    suggestion?: string
    userFriendly: string
  }
}

// PostgreSQL Error Code Mappings
export const ERROR_MAPPINGS: ErrorMapping = {
  // Constraint violation errors
  '23514': {
    message: 'Validation Error: Value out of allowed range',
    suggestion: 'Check that all values are within the expected ranges (e.g., Commission 0-100)',
    userFriendly: 'Please check your input. Some values are outside the allowed range.'
  },
  
  // Not null violation
  '23502': {
    message: 'Missing Data: Please fill in all required fields',
    suggestion: 'Ensure all required fields are completed before submitting',
    userFriendly: 'Please fill in all required fields marked with an asterisk (*).'
  },
  
  // Foreign key violation
  '23503': {
    message: 'Relationship Error: This record is currently in use elsewhere',
    suggestion: 'You cannot delete this record while it is referenced by other records',
    userFriendly: 'This item cannot be deleted because it is being used by other records.'
  },
  
  // Unique violation
  '23505': {
    message: 'Duplicate Entry: This value already exists',
    suggestion: 'Use a different value for this field',
    userFriendly: 'This value already exists. Please use a different value.'
  },
  
  // Exclusion violation
  '23513': {
    message: 'Exclusion Constraint: This combination is not allowed',
    suggestion: 'Choose a different combination of values',
    userFriendly: 'This combination of values is not allowed.'
  },
  
  // String data right truncation
  '22001': {
    message: 'Data Too Long: Text exceeds maximum length',
    suggestion: 'Shorten the text to fit within the character limit',
    userFriendly: 'The text you entered is too long. Please shorten it.'
  },
  
  // Numeric value out of range
  '22003': {
    message: 'Number Too Large: Value exceeds allowed range',
    suggestion: 'Use a smaller number within the allowed range',
    userFriendly: 'The number you entered is too large. Please use a smaller value.'
  },
  
  // Invalid text representation
  '22P02': {
    message: 'Invalid Format: Data format is incorrect',
    suggestion: 'Check the format of your input data',
    userFriendly: 'The format of your data is incorrect. Please check and try again.'
  },
  
  // Invalid input syntax
  '42601': {
    message: 'Syntax Error: Invalid input format',
    suggestion: 'Check the syntax of your input',
    userFriendly: 'There was a syntax error in your input. Please check the format.'
  },
  
  // Insufficient privilege
  '42501': {
    message: 'Permission Denied: You do not have permission to perform this action',
    suggestion: 'Contact your administrator for the required permissions',
    userFriendly: 'You do not have permission to perform this action. Please contact your administrator.'
  },
  
  // Connection exceptions
  '08006': {
    message: 'Connection Failed: Unable to connect to database',
    suggestion: 'Check your internet connection and try again',
    userFriendly: 'Connection to the database failed. Please check your internet connection.'
  },
  
  // Connection does not exist
  '08001': {
    message: 'Connection Error: Database connection failed',
    suggestion: 'Please try again in a few moments',
    userFriendly: 'Unable to connect to the database. Please try again in a few moments.'
  },
  
  // Too many connections
  '53300': {
    message: 'Server Busy: Too many active connections',
    suggestion: 'Please wait a moment and try again',
    userFriendly: 'The server is busy. Please wait a moment and try again.'
  }
}

/**
 * Parse database error and return user-friendly message
 */
export function parseDatabaseError(error: any): {
  userMessage: string
  technicalMessage: string
  code?: string
  suggestion?: string
} {
  // Handle Supabase/Postgres errors
  if (error?.code) {
    const mapping = ERROR_MAPPINGS[error.code]
    if (mapping) {
      return {
        userMessage: mapping.userFriendly,
        technicalMessage: error.message || error.details || error.hint || mapping.message,
        code: error.code,
        suggestion: mapping.suggestion
      }
    }
  }

  // Handle network errors
  if (error?.name === 'TypeError' && error?.message?.includes('fetch')) {
    return {
      userMessage: 'Network Error: Unable to connect to the server',
      technicalMessage: error.message,
      suggestion: 'Check your internet connection and try again'
    }
  }

  // Handle timeout errors
  if (error?.name === 'AbortError' || error?.message?.includes('timeout')) {
    return {
      userMessage: 'Request Timeout: The request took too long',
      technicalMessage: error.message,
      suggestion: 'Please try again. If the problem persists, contact support.'
    }
  }

  // Handle validation errors
  if (error?.name === 'ValidationError' || error?.message?.includes('validation')) {
    return {
      userMessage: 'Validation Error: Please check your input',
      technicalMessage: error.message,
      suggestion: 'Review all fields and correct any errors'
    }
  }

  // Default fallback
  return {
    userMessage: 'An unexpected error occurred',
    technicalMessage: error?.message || 'Unknown error',
    suggestion: 'Please try again. If the problem persists, contact support.'
  }
}

/**
 * Create user-friendly error message for display
 */
export function createErrorMessage(error: any): string {
  const parsed = parseDatabaseError(error)
  return parsed.userMessage
}

/**
 * Create detailed error information for logging/debugging
 */
export function createErrorDetails(error: any): {
  code?: string
  message: string
  suggestion?: string
  timestamp: string
} {
  const parsed = parseDatabaseError(error)
  return {
    code: parsed.code,
    message: parsed.technicalMessage,
    suggestion: parsed.suggestion,
    timestamp: new Date().toISOString()
  }
}

/**
 * Handle soft delete specific errors
 */
export function handleSoftDeleteError(error: any): {
  canRetry: boolean
  userMessage: string
  action?: string
} {
  const parsed = parseDatabaseError(error)
  
  // Foreign key violation - record is in use
  if (parsed.code === '23503') {
    return {
      canRetry: false,
      userMessage: 'Cannot delete this item because it is referenced by other records.',
      action: 'archive'
    }
  }
  
  // Permission denied
  if (parsed.code === '42501') {
    return {
      canRetry: false,
      userMessage: 'You do not have permission to delete this item.',
      action: 'contact_admin'
    }
  }
  
  // Record not found
  if (error?.message?.includes('No rows affected')) {
    return {
      canRetry: false,
      userMessage: 'This item was already deleted or does not exist.',
      action: 'refresh'
    }
  }
  
  return {
    canRetry: true,
    userMessage: parsed.userMessage
  }
}

/**
 * Handle restore specific errors
 */
export function handleRestoreError(error: any): {
  canRetry: boolean
  userMessage: string
  action?: string
} {
  const parsed = parseDatabaseError(error)
  
  // Permission denied
  if (parsed.code === '42501') {
    return {
      canRetry: false,
      userMessage: 'You do not have permission to restore this item.',
      action: 'contact_admin'
    }
  }
  
  // Record not found
  if (error?.message?.includes('No rows affected')) {
    return {
      canRetry: false,
      userMessage: 'This item does not exist or cannot be restored.',
      action: 'refresh'
    }
  }
  
  return {
    canRetry: true,
    userMessage: parsed.userMessage
  }
}

/**
 * Log error for debugging
 */
export function logError(error: any, context?: string): void {
  const details = createErrorDetails(error)
  console.error(`[Database Error${context ? ` - ${context}` : ''}]`, {
    ...details,
    context,
    originalError: error
  })
}

/**
 * Check if error is recoverable
 */
export function isRecoverableError(error: any): boolean {
  const parsed = parseDatabaseError(error)
  
  // These errors are generally recoverable
  const recoverableCodes = [
    '08001', '08006', '53300', // Connection issues
    '22001', '22003', // Data format issues
    '22P02', '42601' // Syntax issues
  ]
  
  return recoverableCodes.includes(parsed.code || '') || 
         error?.name === 'TypeError' || 
         error?.name === 'AbortError'
}

/**
 * Get retry delay for recoverable errors
 */
export function getRetryDelay(error: any, attempt: number): number {
  const parsed = parseDatabaseError(error)
  
  // Connection errors - exponential backoff
  if (['08001', '08006', '53300'].includes(parsed.code || '')) {
    return Math.min(1000 * Math.pow(2, attempt), 30000) // Max 30 seconds
  }
  
  // Other errors - shorter delay
  return Math.min(500 * Math.pow(2, attempt), 5000) // Max 5 seconds
}
