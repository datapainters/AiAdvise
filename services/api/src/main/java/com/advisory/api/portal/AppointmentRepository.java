package com.advisory.api.portal;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AppointmentRepository extends JpaRepository<Appointment, Long> {

    List<Appointment> findAllByClientIdOrderByStartsAtDesc(Long clientId);

    List<Appointment> findAllByOrderByStartsAtDesc();
}
