// Package mailer sends transactional email (currently password-reset links).
// When SMTP is not configured it logs the message instead, so local
// development and tests don't require a mail server.
package mailer

import (
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"net/smtp"
	"os"
	"strconv"
	"strings"
)

// Config holds the SMTP settings and the public app base URL used to build
// reset links.
type Config struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
	AppURL   string
}

// ConfigFromEnv builds a Config from the standard UXer SMTP environment
// variables.
func ConfigFromEnv() Config {
	port, _ := strconv.Atoi(os.Getenv("SMTP_PORT"))
	if port == 0 {
		port = 587
	}
	return Config{
		Host:     os.Getenv("SMTP_HOST"),
		Port:     port,
		Username: os.Getenv("SMTP_USER"),
		Password: os.Getenv("SMTP_PASSWORD"),
		From:     os.Getenv("SMTP_FROM"),
		AppURL:   strings.TrimRight(os.Getenv("UXER_APP_URL"), "/"),
	}
}

// Mailer delivers email through SMTP, falling back to logging.
type Mailer struct {
	cfg Config
}

// New builds a Mailer from cfg.
func New(cfg Config) *Mailer {
	return &Mailer{cfg: cfg}
}

// Enabled reports whether SMTP delivery is configured.
func (m *Mailer) Enabled() bool {
	return m.cfg.Host != "" && m.cfg.From != ""
}

// ResetURL builds the password-reset URL for a raw token.
func (m *Mailer) ResetURL(token string) string {
	base := m.cfg.AppURL
	if base == "" {
		base = "http://localhost:8088"
	}
	return base + "/reset-password?token=" + token
}

// SendPasswordReset sends (or, without SMTP, logs) a password-reset link.
func (m *Mailer) SendPasswordReset(to, name, resetURL string) error {
	if !m.Enabled() {
		log.Printf("password reset (SMTP not configured) for %s: %s", to, resetURL)
		return nil
	}
	subject := "Reset your UXer password"
	greeting := "Hello"
	if name != "" {
		greeting = "Hello " + name
	}
	body := fmt.Sprintf(
		"%s,\r\n\r\nWe received a request to reset your UXer password.\r\n\r\n"+
			"To reset your password, open this link (it expires in 1 hour):\r\n%s\r\n\r\n"+
			"If you didn't request this, you can safely ignore this email.\r\n",
		greeting, resetURL,
	)
	msg := []byte(fmt.Sprintf(
		"From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\n"+
			"Content-Type: text/plain; charset=UTF-8\r\n\r\n%s",
		m.cfg.From, to, subject, body,
	))
	return m.deliver(to, msg)
}

func (m *Mailer) deliver(to string, msg []byte) error {
	addr := net.JoinHostPort(m.cfg.Host, strconv.Itoa(m.cfg.Port))

	// Port 465 commonly implies implicit TLS. Otherwise let net/smtp
	// negotiate STARTTLS when the server advertises it.
	if m.cfg.Port == 465 {
		conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: m.cfg.Host})
		if err != nil {
			return err
		}
		c, err := smtp.NewClient(conn, m.cfg.Host)
		if err != nil {
			return err
		}
		defer c.Close()
		if m.cfg.Username != "" {
			if err := c.Auth(smtp.PlainAuth("", m.cfg.Username, m.cfg.Password, m.cfg.Host)); err != nil {
				return err
			}
		}
		if err := c.Mail(m.cfg.From); err != nil {
			return err
		}
		if err := c.Rcpt(to); err != nil {
			return err
		}
		w, err := c.Data()
		if err != nil {
			return err
		}
		if _, err := w.Write(msg); err != nil {
			return err
		}
		if err := w.Close(); err != nil {
			return err
		}
		return c.Quit()
	}

	var auth smtp.Auth
	if m.cfg.Username != "" {
		auth = smtp.PlainAuth("", m.cfg.Username, m.cfg.Password, m.cfg.Host)
	}
	return smtp.SendMail(addr, auth, m.cfg.From, []string{to}, msg)
}
